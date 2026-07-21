import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { getDb } from "./db";
import {
  informesCentrosCosto,
  informesCuentasPuc,
  informesCargas,
  informesSaldosMensuales,
  informesReportes,
} from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { resolverColumnas, esAnulado, periodoDeFila, type ColumnasResueltas } from "./informesParseUtils";

// ==================== CATÁLOGO DE CENTROS DE COSTO (por cliente) ====================
// Solo aplica a clientes que manejan centro de costo (ej. Colfamil). Para el
// resto, simplemente no se siembra nada y todo cae en centroCodigo="SC".

/** Seed conocido de Colfamil (23 puntos + Adm), disponible como conveniencia
 * para no tener que digitarlo a mano si se vuelve a necesitar. No se aplica
 * automáticamente a ningún cliente — se invoca explícitamente pasando el
 * clienteId correcto. */
export const CENTROS_SEED_COLFAMIL: Record<string, string> = {
  "01": "Simon Bolivar", "02": "Gaitan", "03": "Cantabria", "04": "Ricaurte",
  "05": "Jardin", "06": "Belen", "07": "C 60", "08": "Samaria", "09": "Salado",
  "10": "Jardin Alto", "11": "Jordan II", "12": "Gaviota", "13": "C 37",
  "14": "Picalena", "15": "Florida", "16": "Ambala", "17": "Parrales",
  "18": "Ricaurte Parte Alta", "19": "Federico Lleras", "20": "Calle 22",
  "21": "Protecho", "22": "Avenida Ambala", "23": "Arboleda Campestre",
  "99": "Administracion",
};

/** Siembra un catálogo de centros de costo para un cliente específico. No
 * hace nada si ese cliente ya tiene centros cargados (no pisa nombres
 * editados). */
export async function seedCentrosCosto(clienteId: number, mapa: Record<string, string>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existentes = await db.select().from(informesCentrosCosto)
    .where(eq(informesCentrosCosto.clienteId, clienteId));
  if (existentes.length > 0) return;
  for (const [codigo, nombre] of Object.entries(mapa)) {
    await db.insert(informesCentrosCosto).values({ clienteId, codigo, nombre, activo: true });
  }
}

export async function getCentrosCosto(clienteId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(informesCentrosCosto)
    .where(eq(informesCentrosCosto.clienteId, clienteId))
    .orderBy(informesCentrosCosto.codigo);
}

export async function updateCentroCosto(id: number, data: { nombre?: string; activo?: boolean }) {
  const db = await getDb();
  if (!db) return;
  await db.update(informesCentrosCosto).set(data).where(eq(informesCentrosCosto.id, id));
}

export async function createCentroCosto(clienteId: number, codigo: string, nombre: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(informesCentrosCosto).values({ clienteId, codigo, nombre, activo: true });
}

// ==================== PARSEO DEL LIBRO AUXILIAR ====================

export type TipoSaldo = "ingreso" | "costo" | "gasto" | "descuento_pp";

export type Agregado = {
  // centroCodigo -> cuenta (detalle completo, sin truncar) -> {tipo, valor}
  detalle: Record<string, Record<string, { tipo: TipoSaldo; valor: number }>>;
  totalFilas: number;
  filasFueraDePeriodo: number;
  cuentasNuevas: Set<string>;
};

/** Lee el libro auxiliar/movimiento (streaming, soporta archivos de cientos de
 * miles de filas) y agrega DÉBITO/CRÉDITO por centro de costo + cuenta PUC a
 * DETALLE COMPLETO (el código tal cual viene en la columna de cuenta, sin
 * truncar a 4 dígitos — así el informe puede agregar a nivel de cuenta 4
 * dígitos ej. 5105, o mostrar cada subcuenta). Filtra registros anulados.
 * Clasifica por el primer dígito de la cuenta: 4=ingreso (crédito-débito),
 * 5=gasto (débito-crédito), 6=costo (débito-crédito).
 *
 * Las columnas se reconocen por sinónimo (ver informesParseUtils), no por
 * nombre exacto — cada cliente puede traer un formato distinto de su
 * sistema contable, siempre que tenga fecha, cuenta, débito y crédito
 * identificables. Se lanza un error legible si falta alguna.
 *
 * Cada fila se valida contra el periodo objetivo (anioObjetivo/mesObjetivo,
 * el que el usuario seleccionó al subir el archivo) usando su propia fecha:
 * las filas de otro mes se excluyen y se cuentan en filasFueraDePeriodo, en
 * vez de mezclarse silenciosamente con el periodo equivocado.
 *
 * El descuento por pronto pago (subcuentas 613505/613506) se clasifica APARTE
 * con tipo "descuento_pp" en vez de netearse dentro de "costo" — así el
 * reporte puede mostrar costo bruto, descuento pronto pago y costo neto como
 * tres líneas separadas, y armar el análisis de pronto pago. */
export async function parseLibroAuxiliar(
  filePathOrBuffer: string | Buffer,
  cuentasConocidas: Set<string>,
  anioObjetivo: number,
  mesObjetivo: number,
): Promise<Agregado> {
  const detalle: Agregado["detalle"] = {};
  const cuentasNuevas = new Set<string>();
  let totalFilas = 0;
  let filasFueraDePeriodo = 0;

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(filePathOrBuffer as any, {});
  let header: any[] | null = null;
  let cols: ColumnasResueltas | null = null;

  for await (const worksheetReader of reader) {
    for await (const row of worksheetReader) {
      const values = row.values as any[];
      if (!header) {
        header = values;
        cols = resolverColumnas(header);
        continue;
      }
      const c = cols!;
      totalFilas++;
      if (c.anulado !== null && esAnulado(values[c.anulado])) continue;

      const periodo = periodoDeFila(values, c);
      if (!periodo || periodo.anio !== anioObjetivo || periodo.mes !== mesObjetivo) {
        filasFueraDePeriodo++;
        continue;
      }

      const cuentaRaw = values[c.cuenta];
      if (!cuentaRaw) continue;
      const cuentaKey = String(cuentaRaw).trim();
      const primerDigito = cuentaKey[0];
      if (!"456".includes(primerDigito)) continue;

      if (!cuentasConocidas.has(cuentaKey)) cuentasNuevas.add(cuentaKey);

      let ccosto = c.centroCosto !== null ? values[c.centroCosto] : null;
      ccosto = ccosto === null || ccosto === undefined || ccosto === ""
        ? "SC" : String(ccosto).padStart(2, "0");

      const debito = Number(values[c.debito]) || 0;
      const credito = Number(values[c.credito]) || 0;
      const esProntoPago = primerDigito === "6" && (cuentaKey.startsWith("613505") || cuentaKey.startsWith("613506"));

      if (!detalle[ccosto]) detalle[ccosto] = {};
      if (!detalle[ccosto][cuentaKey]) {
        const tipo: TipoSaldo = esProntoPago ? "descuento_pp"
          : primerDigito === "4" ? "ingreso"
          : primerDigito === "5" ? "gasto" : "costo";
        detalle[ccosto][cuentaKey] = { tipo, valor: 0 };
      }
      // El descuento pronto pago se guarda en positivo (es un ahorro/crédito);
      // costo y gasto en su convención normal débito-crédito; ingreso crédito-débito.
      const valorDelta =
        primerDigito === "4" ? credito - debito :
        primerDigito === "5" ? debito - credito :
        esProntoPago ? credito - debito :
        debito - credito;
      detalle[ccosto][cuentaKey].valor += valorDelta;
    }
  }

  return { detalle, totalFilas, filasFueraDePeriodo, cuentasNuevas };
}

// ==================== CATÁLOGO DE CUENTAS PUC (con IA, compartido entre clientes) ====================

export async function getCuentasPucConocidas(): Promise<Map<string, { descripcion: string | null; tipo: string }>> {
  const db = await getDb();
  const map = new Map<string, { descripcion: string | null; tipo: string }>();
  if (!db) return map;
  const filas = await db.select().from(informesCuentasPuc);
  for (const f of filas) map.set(f.cuenta, { descripcion: f.descripcion, tipo: f.tipo });
  return map;
}

function tipoDeCuenta(cuenta: string): "ingreso" | "costo" | "gasto" | "descuento_pp" {
  if (cuenta.startsWith("613505") || cuenta.startsWith("613506")) return "descuento_pp";
  if (cuenta[0] === "4") return "ingreso";
  if (cuenta[0] === "5") return "gasto";
  return "costo";
}

/** Para cuentas que aparecen por primera vez, le pide a la IA (mismo backend
 * Anthropic ya usado para el RUT) una descripción PUC colombiana estándar, y
 * guarda el resultado para no volver a preguntar. Compartido entre clientes:
 * el PUC es un estándar nacional, no depende de quién lo cargó. */
export async function clasificarCuentasNuevas(cuentasNuevas: string[]): Promise<void> {
  const db = await getDb();
  if (!db || cuentasNuevas.length === 0) return;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `Eres un experto en el Plan Único de Cuentas (PUC) colombiano. Dado un listado de códigos de cuenta contable (pueden venir a distintos niveles de detalle, 4 a 10+ dígitos), responde ÚNICAMENTE un JSON con un array de objetos {"cuenta": "xxxxxx", "descripcion": "nombre estándar de la cuenta PUC"}. Si no reconoces el código exacto, da la mejor descripción genérica según el grupo/cuenta PUC (primeros dígitos). Responde solo JSON, sin texto adicional ni markdown.`,
      },
      { role: "user", content: `Cuentas: ${cuentasNuevas.join(", ")}` },
    ],
  });

  try {
    const raw = response.choices?.[0]?.message?.content || "[]";
    const jsonStr = raw.includes("```") ? (raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? raw) : raw;
    const parsed: { cuenta: string; descripcion: string }[] = JSON.parse(jsonStr);
    for (const cuenta of cuentasNuevas) {
      const found = parsed.find(p => p.cuenta === cuenta);
      const tipo = tipoDeCuenta(cuenta);
      await db.insert(informesCuentasPuc)
        .values({ cuenta, descripcion: found?.descripcion || null, tipo, clasificadoPorIA: true })
        .onDuplicateKeyUpdate({ set: { descripcion: found?.descripcion || null } });
    }
  } catch (error) {
    console.error("[Informes] Clasificación IA de cuentas falló:", error);
    // Aun sin descripción, se guarda el tipo (derivado del código) para no reintentar en cada carga.
    for (const cuenta of cuentasNuevas) {
      await db.insert(informesCuentasPuc)
        .values({ cuenta, descripcion: null, tipo: tipoDeCuenta(cuenta), clasificadoPorIA: false })
        .onDuplicateKeyUpdate({ set: {} });
    }
  }
}

// ==================== PERSISTENCIA DE CARGAS MENSUALES (por cliente) ====================

export async function crearCarga(data: {
  clienteId: number; anio: number; mes: number; nombreArchivo: string; fileKey?: string; cargadoPorId: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const result = await db.insert(informesCargas).values({ ...data, estado: "procesando" });
  return Number((result as any).insertId ?? (result as any)[0]?.insertId);
}

export async function marcarCargaCompletada(cargaId: number, totalFilas: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(informesCargas).set({ estado: "completado", totalFilas }).where(eq(informesCargas.id, cargaId));
}

export async function marcarCargaError(cargaId: number, mensaje: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(informesCargas).set({ estado: "error", mensajeError: mensaje }).where(eq(informesCargas.id, cargaId));
}

/** Reemplaza (upsert) los saldos agregados de un cliente/mes/centro/cuenta.
 * Si el usuario vuelve a cargar el mismo mes (corrección), pisa los valores
 * anteriores de ese periodo en vez de duplicarlos. */
export async function guardarSaldosMensuales(
  cargaId: number, clienteId: number, anio: number, mes: number, detalle: Agregado["detalle"],
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const [centroCodigo, cuentas] of Object.entries(detalle)) {
    for (const [cuenta, { tipo, valor }] of Object.entries(cuentas)) {
      await db.insert(informesSaldosMensuales)
        .values({ cargaId, clienteId, anio, mes, centroCodigo, cuenta, tipo, valor })
        .onDuplicateKeyUpdate({ set: { valor, tipo, cargaId } });
    }
  }
}

export async function listarCargas(clienteId: number, anio?: number) {
  const db = await getDb();
  if (!db) return [];
  const condiciones = [eq(informesCargas.clienteId, clienteId)];
  if (anio) condiciones.push(eq(informesCargas.anio, anio));
  return db.select().from(informesCargas).where(and(...condiciones));
}

/** Trae todos los saldos guardados de un cliente + año (para calcular
 * promedios, armar la serie mensual completa por centro, o sumar todos los
 * centros para el Estado de Resultados Mensual comparativo), sin importar
 * cuántos meses ya se hayan cargado. */
export async function getSaldosDelAnio(clienteId: number, anio: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(informesSaldosMensuales)
    .where(and(eq(informesSaldosMensuales.clienteId, clienteId), eq(informesSaldosMensuales.anio, anio)));
}

export async function guardarReporteGenerado(data: {
  clienteId: number; anio: number; mes?: number | null; tipo: "ERM" | "ERI";
  nivel: "resumen" | "detalle"; fileKey: string; generadoPorId: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(informesReportes).values({ ...data, mes: data.mes ?? null });
}

export async function listarReportes(clienteId: number, anio?: number) {
  const db = await getDb();
  if (!db) return [];
  const condiciones = [eq(informesReportes.clienteId, clienteId)];
  if (anio) condiciones.push(eq(informesReportes.anio, anio));
  return db.select().from(informesReportes).where(and(...condiciones));
}
