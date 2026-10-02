import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db";
import { informesBalanceCargas, informesBalanceSaldos, informesBalanceNotas, informesCuentasCliente } from "../drizzle/schema";
import { leerBalancePrueba } from "./informesBalanceParse";
import { leerFilasXlsxRobusto } from "./xlsxRobusto";
import { storagePut } from "./storage";
import { esCuentaDeEfectivo } from "../shared/flujoEfectivo";

/** BALANCE DE PRUEBA — persistencia e historial. Cada mes se sube un
 * archivo; aquí se guarda por cuenta y se arma el Estado de Situación
 * Financiera comparativo del año (un mes por columna), con la misma
 * estructura de la hoja "ESF" del informe financiero. */

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
const redondear = (n: number) => Math.round(n * 100) / 100;
const TOLERANCIA = 1;

export type ResultadoCargaBalance = {
  anio: number; mes: number;
  /** De dónde salió el mes: de los títulos del archivo o de lo que eligió el contador. */
  periodoDetectado: boolean;
  cuentasDetalle: number; porTercero: boolean; signoInvertido: boolean;
  diferenciaEcuacion: number; diferenciaMovimiento: number; cuentasInconsistentes: number;
};

/** Lee el balance de prueba y deja guardado ese mes (reemplaza lo que
 * hubiera). Si no se indica el mes, se toma del archivo. */
export async function cargarBalance(datos: {
  clienteId: number; buffer: Buffer; nombreArchivo: string; anio: number | null; mes: number | null; userId: number;
}): Promise<ResultadoCargaBalance> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const filas = await leerFilasXlsxRobusto(datos.buffer);
  const balance = leerBalancePrueba(filas);

  const elegido = datos.anio !== null && datos.mes !== null;
  const periodo = elegido ? { anio: datos.anio!, mes: datos.mes! } : balance.periodoDetectado;
  if (!periodo) {
    throw new Error("No se pudo saber de qué mes es el balance por los títulos del archivo. Elige el mes antes de subirlo.");
  }
  const { anio, mes } = periodo;
  const { clienteId } = datos;

  // El archivo original se conserva; si el almacenamiento falla, el
  // balance igual queda cargado (lo que se usa son los saldos).
  let fileKey: string | null = null;
  try {
    fileKey = (await storagePut(
      `informes/balance/${clienteId}_${anio}_${String(mes).padStart(2, "0")}_${Date.now()}_${datos.nombreArchivo}`,
      datos.buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )).key;
  } catch (error: any) {
    console.error("[Informes/Balance] No se pudo guardar el archivo original:", String(error?.message || error).slice(0, 300));
  }

  const delPeriodo = and(eq(informesBalanceSaldos.clienteId, clienteId), eq(informesBalanceSaldos.anio, anio), eq(informesBalanceSaldos.mes, mes));
  await db.delete(informesBalanceSaldos).where(delPeriodo);
  for (let i = 0; i < balance.cuentas.length; i += 200) {
    await db.insert(informesBalanceSaldos).values(balance.cuentas.slice(i, i + 200).map(c => ({ clienteId, anio, mes, ...c })));
  }
  const resumen = {
    nombreArchivo: datos.nombreArchivo.slice(0, 255), fileKey, cuentasDetalle: balance.cuentasDetalle, porTercero: balance.porTercero,
    diferenciaEcuacion: balance.diferenciaEcuacion, diferenciaMovimiento: balance.diferenciaMovimiento,
    cuentasInconsistentes: balance.cuentasInconsistentes, cargadoPorId: datos.userId, createdAt: new Date(),
  };
  await db.insert(informesBalanceCargas).values({ clienteId, anio, mes, ...resumen }).onDuplicateKeyUpdate({ set: resumen });
  await sembrarNombres(db, clienteId, balance.cuentas);

  return {
    anio, mes, periodoDetectado: !elegido, cuentasDetalle: balance.cuentasDetalle, porTercero: balance.porTercero,
    signoInvertido: balance.signoInvertido, diferenciaEcuacion: balance.diferenciaEcuacion,
    diferenciaMovimiento: balance.diferenciaMovimiento, cuentasInconsistentes: balance.cuentasInconsistentes,
  };
}

/** El balance trae el nombre de todas las cuentas, en todos los niveles:
 * se agregan al catálogo del cliente las que faltaban (nunca se cambia un
 * nombre que ya esté). Así los demás informes también las nombran. */
async function sembrarNombres(db: Db, clienteId: number, cuentas: { cuenta: string; nombre: string }[]): Promise<void> {
  const existentes = new Set((await db.select({ cuenta: informesCuentasCliente.cuenta }).from(informesCuentasCliente)
    .where(eq(informesCuentasCliente.clienteId, clienteId))).map(f => f.cuenta));
  const nuevos = cuentas
    .filter(c => c.nombre && c.cuenta.length <= 12 && !existentes.has(c.cuenta))
    .map(c => ({ clienteId, cuenta: c.cuenta, nombre: c.nombre, origen: "archivo" as const }));
  for (let i = 0; i < nuevos.length; i += 200) {
    await db.insert(informesCuentasCliente).values(nuevos.slice(i, i + 200)).onDuplicateKeyUpdate({ set: { clienteId } });
  }
}

export async function eliminarBalance(clienteId: number, anio: number, mes: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(informesBalanceSaldos).where(and(eq(informesBalanceSaldos.clienteId, clienteId), eq(informesBalanceSaldos.anio, anio), eq(informesBalanceSaldos.mes, mes)));
  await db.delete(informesBalanceCargas).where(and(eq(informesBalanceCargas.clienteId, clienteId), eq(informesBalanceCargas.anio, anio), eq(informesBalanceCargas.mes, mes)));
}

export async function guardarNotaCuenta(
  clienteId: number, cuenta: string, nota: { estado: "OK" | "PE" | "RE" | null; observacion: string | null }, userId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const codigo = cuenta.replace(/\D/g, "").slice(0, 20);
  if (!codigo) throw new Error("Cuenta inválida.");
  const observacion = nota.observacion?.trim() ? nota.observacion.trim().slice(0, 2000) : null;
  const donde = and(eq(informesBalanceNotas.clienteId, clienteId), eq(informesBalanceNotas.cuenta, codigo));
  if (!nota.estado && !observacion) { await db.delete(informesBalanceNotas).where(donde); return; }
  const datos = { estado: nota.estado, observacion, actualizadoPorId: userId };
  await db.insert(informesBalanceNotas).values({ clienteId, cuenta: codigo, ...datos }).onDuplicateKeyUpdate({ set: datos });
}

// ---------------------------------------------------------------------
// Estado de Situación Financiera comparativo
// ---------------------------------------------------------------------

export type FilaESF = {
  cuenta: string; nombre: string;
  /** Saldo con el que abre el primer mes cargado. */
  inicial: number;
  /** Saldo al cierre de cada mes cargado. */
  valores: Record<number, number>;
  estado: "OK" | "PE" | "RE" | null; observacion: string | null;
};
export type SerieESF = { inicial: number; valores: Record<number, number> };

export type MesBalance = {
  mes: number; nombreArchivo: string; cargadoEn: Date; cuentasDetalle: number; porTercero: boolean;
  diferenciaEcuacion: number; diferenciaMovimiento: number; cuentasInconsistentes: number;
  /** Cuentas cuyo saldo anterior no es el saldo final del mes anterior
   * cargado (null si el mes anterior no está cargado). */
  sinContinuidad: { cuentas: number; mayorCuenta: string; mayorNombre: string; mayorDiferencia: number } | null;
};

export type ESF = {
  anio: number;
  meses: number[];
  /** Título de la columna de apertura: el año anterior si el primer mes
   * cargado es enero; si no, el saldo anterior de ese primer mes. */
  etiquetaInicial: string;
  cargas: MesBalance[];
  activo: FilaESF[]; pasivo: FilaESF[]; patrimonio: FilaESF[];
  /** Ingresos − gastos − costos acumulados, según el mismo balance. */
  resultado: SerieESF;
  totalActivo: SerieESF; totalPasivo: SerieESF; totalPatrimonio: SerieESF; pasivoPatrimonio: SerieESF;
  /** Activo − (pasivo + patrimonio): cero si la contabilidad cuadra. */
  diferencia: SerieESF;
};

const MESES_NOMBRE = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export async function armarESF(clienteId: number, anio: number): Promise<ESF> {
  const serieVacia = (): SerieESF => ({ inicial: 0, valores: {} });
  const esf: ESF = {
    anio, meses: [], etiquetaInicial: String(anio - 1), cargas: [], activo: [], pasivo: [], patrimonio: [],
    resultado: serieVacia(), totalActivo: serieVacia(), totalPasivo: serieVacia(), totalPatrimonio: serieVacia(),
    pasivoPatrimonio: serieVacia(), diferencia: serieVacia(),
  };
  const db = await getDb();
  if (!db) return esf;

  const [cargas, saldos, notas] = await Promise.all([
    db.select().from(informesBalanceCargas).where(and(eq(informesBalanceCargas.clienteId, clienteId), eq(informesBalanceCargas.anio, anio))),
    // Solo las cuentas de detalle: son las que se suman. Con diciembre del
    // año anterior, para revisar que enero empate con ese cierre.
    db.select().from(informesBalanceSaldos).where(and(
      eq(informesBalanceSaldos.clienteId, clienteId), eq(informesBalanceSaldos.esDetalle, true),
      or(eq(informesBalanceSaldos.anio, anio), and(eq(informesBalanceSaldos.anio, anio - 1), eq(informesBalanceSaldos.mes, 12))),
    )),
    db.select().from(informesBalanceNotas).where(eq(informesBalanceNotas.clienteId, clienteId)),
  ]);
  if (cargas.length === 0) return esf;

  const meses = cargas.map(c => c.mes).sort((a, b) => a - b);
  const primero = meses[0];
  esf.meses = meses;
  esf.etiquetaInicial = primero === 1 ? String(anio - 1) : `Saldo anterior a ${MESES_NOMBRE[primero]}`;

  const delAnio = saldos.filter(s => s.anio === anio);
  const porMes = new Map<number, Map<string, (typeof saldos)[number]>>();
  for (const s of saldos) {
    const clave = s.anio === anio ? s.mes : 0; // 0 = diciembre del año anterior
    if (!porMes.has(clave)) porMes.set(clave, new Map());
    porMes.get(clave)!.set(s.cuenta, s);
  }

  // ---- Filas: una por cuenta de detalle de activo, pasivo y patrimonio ----
  const notaDe = new Map(notas.map(n => [n.cuenta, n]));
  const cuentas = Array.from(new Set(delAnio.filter(s => "123".includes(s.cuenta[0])).map(s => s.cuenta))).sort();
  const fila = (cuenta: string): FilaESF => {
    const valores: Record<number, number> = {};
    let nombre = "";
    for (const m of meses) {
      const s = porMes.get(m)?.get(cuenta);
      valores[m] = s?.saldoFinal || 0;
      if (s?.nombre) nombre = s.nombre; // queda el del mes más reciente
    }
    const nota = notaDe.get(cuenta);
    return { cuenta, nombre, inicial: porMes.get(primero)?.get(cuenta)?.saldoInicial || 0, valores, estado: nota?.estado || null, observacion: nota?.observacion || null };
  };
  const filas = cuentas.map(fila);
  esf.activo = filas.filter(f => f.cuenta[0] === "1");
  esf.pasivo = filas.filter(f => f.cuenta[0] === "2");
  esf.patrimonio = filas.filter(f => f.cuenta[0] === "3");

  // ---- Resultado del ejercicio y totales ----
  const sumaClases = (m: number, clases: string, campo: "saldoInicial" | "saldoFinal") =>
    Array.from(porMes.get(m)?.values() || []).filter(s => clases.includes(s.cuenta[0])).reduce((t, s) => t + s[campo], 0);
  const serie = (calcular: (m: number, campo: "saldoInicial" | "saldoFinal") => number): SerieESF => {
    const valores: Record<number, number> = {};
    for (const m of meses) valores[m] = redondear(calcular(m, "saldoFinal"));
    return { inicial: redondear(calcular(primero, "saldoInicial")), valores };
  };
  esf.resultado = serie((m, campo) => sumaClases(m, "4", campo) - sumaClases(m, "5", campo) - sumaClases(m, "67", campo));
  esf.totalActivo = serie((m, campo) => sumaClases(m, "1", campo));
  esf.totalPasivo = serie((m, campo) => sumaClases(m, "2", campo));
  const combinar = (a: SerieESF, b: SerieESF, signo: 1 | -1): SerieESF => {
    const valores: Record<number, number> = {};
    for (const m of meses) valores[m] = redondear(a.valores[m] + signo * b.valores[m]);
    return { inicial: redondear(a.inicial + signo * b.inicial), valores };
  };
  esf.totalPatrimonio = combinar(serie((m, campo) => sumaClases(m, "3", campo)), esf.resultado, 1);
  esf.pasivoPatrimonio = combinar(esf.totalPasivo, esf.totalPatrimonio, 1);
  esf.diferencia = combinar(esf.totalActivo, esf.pasivoPatrimonio, -1);

  // ---- Estado de cada mes cargado ----
  esf.cargas = cargas.sort((a, b) => a.mes - b.mes).map(c => {
    const actual = porMes.get(c.mes);
    const anterior = porMes.get(c.mes === 1 ? 0 : c.mes - 1);
    let sinContinuidad: MesBalance["sinContinuidad"] = null;
    if (actual && anterior) {
      // De diciembre a enero solo se comparan activo y pasivo: el cierre
      // del año mueve el patrimonio y deja en cero ingresos, gastos y costos.
      const clases = c.mes === 1 ? "12" : "1234567";
      sinContinuidad = { cuentas: 0, mayorCuenta: "", mayorNombre: "", mayorDiferencia: 0 };
      const todas = new Set([...Array.from(actual.keys()), ...Array.from(anterior.keys())]);
      for (const cuenta of Array.from(todas)) {
        if (!clases.includes(cuenta[0])) continue;
        const diferencia = (actual.get(cuenta)?.saldoInicial || 0) - (anterior.get(cuenta)?.saldoFinal || 0);
        if (Math.abs(diferencia) <= TOLERANCIA) continue;
        sinContinuidad.cuentas++;
        if (Math.abs(diferencia) > Math.abs(sinContinuidad.mayorDiferencia)) {
          sinContinuidad.mayorCuenta = cuenta;
          sinContinuidad.mayorNombre = actual.get(cuenta)?.nombre || anterior.get(cuenta)?.nombre || "";
          sinContinuidad.mayorDiferencia = redondear(diferencia);
        }
      }
    }
    return {
      mes: c.mes, nombreArchivo: c.nombreArchivo, cargadoEn: c.createdAt, cuentasDetalle: c.cuentasDetalle, porTercero: c.porTercero,
      diferenciaEcuacion: c.diferenciaEcuacion, diferenciaMovimiento: c.diferenciaMovimiento, cuentasInconsistentes: c.cuentasInconsistentes,
      sinContinuidad,
    };
  });
  return esf;
}

// ---------------------------------------------------------------------
// Saldos de caja y bancos para el Flujo de Efectivo
// ---------------------------------------------------------------------

/** Por cada mes con balance cargado, los saldos inicial y final de las
 * cuentas de efectivo (las de detalle que empiezan por los prefijos
 * configurados). El Flujo de Efectivo los usa en vez de pedir que se
 * digiten. Cada mes trae su propio saldo anterior, así que no hace falta
 * tener cargado el mes de antes. */
export async function saldosEfectivoDeBalance(
  clienteId: number, anio: number, prefijos: string[],
): Promise<Map<number, Map<string, { nombre: string; saldoInicial: number; saldoFinal: number }>>> {
  const resultado = new Map<number, Map<string, { nombre: string; saldoInicial: number; saldoFinal: number }>>();
  const db = await getDb();
  if (!db) return resultado;
  const cargas = await db.select({ mes: informesBalanceCargas.mes }).from(informesBalanceCargas)
    .where(and(eq(informesBalanceCargas.clienteId, clienteId), eq(informesBalanceCargas.anio, anio)));
  if (cargas.length === 0) return resultado;
  for (const c of cargas) resultado.set(c.mes, new Map());
  const saldos = await db.select().from(informesBalanceSaldos).where(and(
    eq(informesBalanceSaldos.clienteId, clienteId), eq(informesBalanceSaldos.anio, anio),
    eq(informesBalanceSaldos.esDetalle, true), inArray(informesBalanceSaldos.mes, cargas.map(c => c.mes)),
  ));
  for (const s of saldos) {
    if (!esCuentaDeEfectivo(s.cuenta, prefijos)) continue;
    resultado.get(s.mes)?.set(s.cuenta, { nombre: s.nombre, saldoInicial: s.saldoInicial, saldoFinal: s.saldoFinal });
  }
  return resultado;
}
