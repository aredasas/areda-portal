import { and, desc, eq, or, lt } from "drizzle-orm";
import { getDb, getClientById } from "./db";
import { informesGestionNotas } from "../drizzle/schema";
import { getCatalogoCliente, getCentrosCosto, getSaldosDelAnio } from "./informesDb";
import { armarESF, type FilaESF } from "./informesBalanceDb";
import {
  calcularInformeGestion, MESES_NOMBRE, type AccionPlan, type BalanceGestion, type InformeGestion, type NotaTributaria, type SaldoGestion,
} from "./informesGestionCalculo";

/** INFORME DE GESTIÓN — reúne lo que ya tiene el portal de un cliente
 * (estado de resultados por mes y centro de costo, balance de prueba si
 * está cargado, y las notas del contador) y lo entrega listo para dibujar. */

export type NotasGestion = { puntos: NotaTributaria[]; plan: AccionPlan[] };
const NIVELES = ["critico", "revisar", "vigilar"];

function leerLista<T>(json: string | null, limpiar: (x: any) => T | null): T[] {
  try {
    const lista = JSON.parse(json || "[]");
    return Array.isArray(lista) ? lista.map(limpiar).filter((x): x is T => x !== null) : [];
  } catch { return []; }
}
const texto = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const limpiarPunto = (x: any): NotaTributaria | null => {
  const titulo = texto(x?.titulo, 160), cuerpo = texto(x?.texto, 2000);
  return titulo || cuerpo ? { nivel: NIVELES.includes(x?.nivel) ? x.nivel : "revisar", titulo, texto: cuerpo } : null;
};
const limpiarAccion = (x: any): AccionPlan | null => {
  const titulo = texto(x?.titulo, 160), cuerpo = texto(x?.texto, 2000);
  return titulo || cuerpo ? { titulo, texto: cuerpo } : null;
};

/** Las notas guardadas para ese corte. Si todavía no hay, se devuelven las
 * del corte anterior más reciente como borrador (`copiadasDe`), para no
 * empezar de cero cada mes — pero al PDF solo van las que se guarden. */
export async function getNotasGestion(clienteId: number, anio: number, mes: number): Promise<NotasGestion & { guardadas: boolean; copiadasDe: { anio: number; mes: number } | null }> {
  const db = await getDb();
  const vacio = { puntos: [], plan: [], guardadas: false, copiadasDe: null };
  if (!db) return vacio;
  const [exacta] = await db.select().from(informesGestionNotas)
    .where(and(eq(informesGestionNotas.clienteId, clienteId), eq(informesGestionNotas.anio, anio), eq(informesGestionNotas.mes, mes))).limit(1);
  if (exacta) return { puntos: leerLista(exacta.puntosJson, limpiarPunto), plan: leerLista(exacta.planJson, limpiarAccion), guardadas: true, copiadasDe: null };
  const [anterior] = await db.select().from(informesGestionNotas)
    .where(and(
      eq(informesGestionNotas.clienteId, clienteId),
      or(lt(informesGestionNotas.anio, anio), and(eq(informesGestionNotas.anio, anio), lt(informesGestionNotas.mes, mes))),
    ))
    .orderBy(desc(informesGestionNotas.anio), desc(informesGestionNotas.mes)).limit(1);
  if (!anterior) return vacio;
  return {
    puntos: leerLista(anterior.puntosJson, limpiarPunto), plan: leerLista(anterior.planJson, limpiarAccion),
    guardadas: false, copiadasDe: { anio: anterior.anio, mes: anterior.mes },
  };
}

export async function guardarNotasGestion(clienteId: number, anio: number, mes: number, notas: NotasGestion, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const datos = {
    puntosJson: JSON.stringify(notas.puntos.map(limpiarPunto).filter(Boolean)),
    planJson: JSON.stringify(notas.plan.map(limpiarAccion).filter(Boolean)),
    actualizadoPorId: userId,
  };
  await db.insert(informesGestionNotas).values({ clienteId, anio, mes, ...datos }).onDuplicateKeyUpdate({ set: datos });
}

/** Nombres de los grupos del PUC (2 dígitos) para el balance por rubros. */
const GRUPOS_BALANCE: Record<string, string> = {
  "11": "Disponible", "12": "Inversiones", "13": "Deudores y anticipos", "14": "Inventarios", "15": "Propiedades, planta y equipo",
  "16": "Intangibles", "17": "Diferidos", "18": "Otros activos", "19": "Valorizaciones",
  "21": "Obligaciones financieras", "22": "Proveedores", "23": "Cuentas por pagar", "24": "Impuestos, gravámenes y tasas",
  "25": "Obligaciones laborales", "26": "Pasivos estimados y provisiones", "27": "Diferidos", "28": "Otros pasivos", "29": "Bonos y papeles comerciales",
};

/** Balance por rubros al mes de corte (o al último mes cargado antes),
 * comparado con la apertura del año, si el cliente tiene balance de prueba. */
async function balanceAlCorte(clienteId: number, anio: number, mesCorte: number): Promise<{
  balance: BalanceGestion | null; diferencia: number | null; efectivoNegativo: { cuenta: string; nombre: string; saldo: number }[];
}> {
  const nada = { balance: null, diferencia: null, efectivoNegativo: [] };
  let esf;
  try { esf = await armarESF(clienteId, anio); } catch { return nada; } // sin las tablas del balance, el informe sale sin esa sección
  const mes = [...esf.meses].reverse().find(m => m <= mesCorte);
  if (!mes) return nada;
  const porGrupo = (filas: FilaESF[]) => {
    const grupos = new Map<string, { inicial: number; final: number }>();
    for (const f of filas) {
      const g = grupos.get(f.cuenta.slice(0, 2)) || { inicial: 0, final: 0 };
      g.inicial += f.inicial; g.final += f.valores[mes] || 0;
      grupos.set(f.cuenta.slice(0, 2), g);
    }
    return Array.from(grupos.entries()).sort((a, b) => a[0].localeCompare(b[0]))
      .map(([codigo, v]) => ({ titulo: GRUPOS_BALANCE[codigo] || `Grupo ${codigo}`, inicial: v.inicial, final: v.final, total: false }));
  };
  const total = (titulo: string, serie: { inicial: number; valores: Record<number, number> }) => ({ titulo, inicial: serie.inicial, final: serie.valores[mes], total: true });
  return {
    balance: {
      etiquetaInicial: esf.etiquetaInicial, etiquetaFinal: `${MESES_NOMBRE[mes][0].toUpperCase()}${MESES_NOMBRE[mes].slice(1)} ${anio}`,
      filas: [
        ...porGrupo(esf.activo), total("Total activo", esf.totalActivo),
        ...porGrupo(esf.pasivo), total("Total pasivo", esf.totalPasivo),
        { ...total("Patrimonio (incluye el resultado del ejercicio)", esf.totalPatrimonio), total: false },
        total("Diferencia sin cuadrar", esf.diferencia),
      ],
    },
    diferencia: esf.diferencia.valores[mes],
    efectivoNegativo: esf.activo.filter(f => f.cuenta.startsWith("11") && (f.valores[mes] || 0) < -1)
      .map(f => ({ cuenta: f.cuenta, nombre: f.nombre, saldo: f.valores[mes] })).sort((a, b) => a.saldo - b.saldo),
  };
}

export type ClienteGestion = {
  razonSocial: string; nit: string | null; ciudad: string | null; departamento: string | null;
  actividadEconomica: string | null; codigoCIIU: string | null; representanteLegal: string | null;
};

/** Meses del año que tienen estado de resultados cargado (para elegir el corte). */
export async function mesesConResultados(clienteId: number, anio: number): Promise<number[]> {
  const saldos = await getSaldosDelAnio(clienteId, anio);
  return Array.from(new Set(saldos.map(s => s.mes))).sort((a, b) => a - b);
}

export async function armarInformeGestion(clienteId: number, anio: number, mesCorte: number): Promise<{ informe: InformeGestion; cliente: ClienteGestion }> {
  const [saldos, centros, catalogo, cliente, notas, delBalance] = await Promise.all([
    getSaldosDelAnio(clienteId, anio), getCentrosCosto(clienteId), getCatalogoCliente(clienteId), getClientById(clienteId),
    // Sin la tabla de notas (migración pendiente) el informe sale igual, sin esas dos secciones.
    getNotasGestion(clienteId, anio, mesCorte).catch(() => ({ puntos: [], plan: [], guardadas: false, copiadasDe: null })),
    balanceAlCorte(clienteId, anio, mesCorte),
  ]);
  if (!cliente) throw new Error("Cliente no encontrado");
  const informe = calcularInformeGestion({
    anio, mesCorte,
    saldos: saldos.map(s => ({ mes: s.mes, centroCodigo: s.centroCodigo, cuenta: s.cuenta, tipo: s.tipo, valor: s.valor })) as SaldoGestion[],
    centros: new Map(centros.map(c => [c.codigo, c.nombre])),
    catalogo, balance: delBalance.balance, balanceDiferencia: delBalance.diferencia, efectivoNegativo: delBalance.efectivoNegativo,
    // Al PDF solo van las notas guardadas para este corte, no el borrador copiado de otro mes.
    notas: notas.guardadas ? { puntos: notas.puntos, plan: notas.plan } : { puntos: [], plan: [] },
  });
  return {
    informe,
    cliente: {
      razonSocial: cliente.razonSocial,
      nit: cliente.nit ? `${cliente.nit}${cliente.digitoVerificacion ? `-${cliente.digitoVerificacion}` : ""}` : null,
      ciudad: cliente.ciudad || null, departamento: cliente.departamento || null,
      actividadEconomica: cliente.actividadEconomica || null, codigoCIIU: cliente.codigoCIIU || null,
      representanteLegal: cliente.representanteLegal || null,
    },
  };
}
