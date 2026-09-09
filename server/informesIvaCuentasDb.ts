import { and, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { getDb } from "./db";
import { informesConfigCuentasIva, informesCuentasCliente, informesCuentasPuc, informesComprasTiposExcluidos, type InformeConfigCuentaIva } from "../drizzle/schema";
import { getCargaConArchivo, normalizarCuentaPUC } from "./informesDb";
import { storageGetBuffer } from "./storage";
import { resolverColumnasAuxiliarDian, type ColsAuxiliarDian } from "./informesDianDb";

export type TipoIva = "generado_19" | "generado_5" | "descontable_19" | "descontable_5" | "transitorio" | "cuenta_mayor";

const CUENTA_MAYOR_IVA_DEFECTO = "24";

/** La cuenta mayor de IVA — casi siempre la 24 (impuestos, gravámenes y
 * tasas por pagar), pero en casos excepcionales el cliente usa un código
 * distinto en su PUC. Se guarda por cliente; si nunca se ha confirmado,
 * se usa "24" como valor por defecto (comportamiento de siempre). */
export async function getCuentaMayorIva(clienteId: number): Promise<string> {
  const db = await getDb();
  if (!db) return CUENTA_MAYOR_IVA_DEFECTO;
  const fila = await db.select().from(informesConfigCuentasIva)
    .where(and(eq(informesConfigCuentasIva.clienteId, clienteId), eq(informesConfigCuentasIva.tipoIva, "cuenta_mayor"))).limit(1);
  return fila[0]?.cuenta || CUENTA_MAYOR_IVA_DEFECTO;
}

export async function guardarCuentaMayorIva(clienteId: number, cuenta: string, userId: number): Promise<void> {
  await guardarConfigCuentasIva(clienteId, [{ tipoIva: "cuenta_mayor", cuenta }], userId);
}

export type ConvencionSaldo = "pasivo" | "activo_gasto";

/** Lee el libro auxiliar (mismo archivo ya cargado para Estado de
 * Resultados/Comparación DIAN) y suma el saldo de CADA cuenta que
 * empiece con alguno de los prefijos dados — para cuentas de balance
 * (como la 2408 de IVA, o la 14/62 de compras) que `informesSaldosMensuales`
 * descarta por completo o no discrimina lo suficiente (esa tabla solo
 * guarda ingreso/costo/gasto agregado por cuenta, sin tipo de
 * comprobante). "pasivo" (el default) usa crédito-débito, correcto
 * para cuentas como la 24 de IVA, que aumentan con el crédito.
 * "activo_gasto" usa débito-crédito, correcto para cuentas de activo
 * (14 inventario) o costo/gasto (5, 62), que aumentan con el débito —
 * usar la convención equivocada invierte el signo del resultado. */
/** Confirma que la columna de cuenta detectada realmente contenga
 * códigos numéricos (ej. "240805"), no el nombre descriptivo de la
 * cuenta — un sinónimo genérico puede coincidir con la columna
 * equivocada (ej. "Cuenta contable" en vez de "Código contable"), y sin
 * esta validación el filtro por prefijo nunca encuentra nada (el nombre
 * nunca empieza en "24"), pareciendo que la cuenta no existe en el
 * archivo cuando en realidad sí está — mismo bug ya corregido antes en
 * el parser de la Comparación DIAN. */
function columnaCuentaEsConfiable(filas: any[][], colIndex: number): boolean {
  const muestra = filas.slice(1, 51).map(f => f?.[colIndex]).filter(v => v !== null && v !== undefined && v !== "");
  if (muestra.length === 0) return false;
  const numericos = muestra.filter(v => /^\d+$/.test(String(v).trim())).length;
  return numericos / muestra.length >= 0.7;
}

// Se normaliza el código de cuenta (mismo criterio del formato
// "Syscafe" que ya usa el resto del sistema) porque el catálogo de
// cuentas del cliente (plan de cuentas subido aparte) guarda los
// nombres con el código YA NORMALIZADO — sin esto, un código impar del
// libro auxiliar (ej. "240805001") nunca coincidía con la clave del
// catálogo ("24080501"), y la cuenta aparecía siempre "sin nombre"
// aunque el plan de cuentas sí la tuviera.
function sumarSaldosPorCuenta(buffer: Buffer, prefijos: string[], convencion: ConvencionSaldo = "pasivo"): Map<string, number> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (filas.length < 2) return new Map();

  const cols: ColsAuxiliarDian = resolverColumnasAuxiliarDian(filas[0]);
  if (cols.cuenta === null || !columnaCuentaEsConfiable(filas, cols.cuenta)) return new Map();

  const saldos = new Map<string, number>();
  for (let i = 1; i < filas.length; i++) {
    const values = filas[i];
    if (!values) continue;
    const cuentaRaw = normalizarCuentaPUC(String(values[cols.cuenta] ?? "").trim());
    if (!cuentaRaw || !prefijos.some(p => cuentaRaw.startsWith(p))) continue;
    const debito = Number(values[cols.debito]) || 0;
    const credito = Number(values[cols.credito]) || 0;
    const delta = convencion === "pasivo" ? (credito - debito) : (debito - credito);
    saldos.set(cuentaRaw, (saldos.get(cuentaRaw) || 0) + delta);
  }
  return saldos;
}

/** Igual que `sumarSaldosPorCuenta`, pero conserva también el tipo de
 * comprobante de cada línea — necesario cuando hace falta filtrar por
 * tipo de documento antes de sumar (ej. excluir los asientos internos
 * de costo de venta de las cuentas 14/62, que no son compras reales). */
function sumarSaldosPorCuentaYTipo(buffer: Buffer, prefijos: string[], convencion: ConvencionSaldo): Map<string, { cuenta: string; tipo: string; valor: number }> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (filas.length < 2) return new Map();

  const cols: ColsAuxiliarDian = resolverColumnasAuxiliarDian(filas[0]);
  if (cols.cuenta === null || !columnaCuentaEsConfiable(filas, cols.cuenta)) return new Map();

  const saldos = new Map<string, { cuenta: string; tipo: string; valor: number }>();
  for (let i = 1; i < filas.length; i++) {
    const values = filas[i];
    if (!values) continue;
    const cuentaRaw = normalizarCuentaPUC(String(values[cols.cuenta] ?? "").trim());
    if (!cuentaRaw || !prefijos.some(p => cuentaRaw.startsWith(p))) continue;
    // Igual que en `parseAuxiliarParaDian`: si no hay una columna de tipo
    // dedicada, el tipo suele venir combinado con el número en un solo
    // campo "Comprobante" (ej. "FC-00526" = tipo "FC", número "526") —
    // se toma el prefijo alfabético de ese mismo campo como sustituto.
    const numeroTexto = String(values[cols.numero] ?? "");
    const tipoRaw = cols.tipo !== null
      ? String(values[cols.tipo] ?? "").trim()
      : (numeroTexto.match(/^[A-Za-z]+/)?.[0] || "");
    const debito = Number(values[cols.debito]) || 0;
    const credito = Number(values[cols.credito]) || 0;
    const delta = convencion === "pasivo" ? (credito - debito) : (debito - credito);
    const clave = `${cuentaRaw}|${tipoRaw}`;
    if (!saldos.has(clave)) saldos.set(clave, { cuenta: cuentaRaw, tipo: tipoRaw, valor: 0 });
    saldos.get(clave)!.valor += delta;
  }
  return saldos;
}

export type TipoComprobanteConValor = { tipo: string; cantidad: number; valor: number };

/** Lista, sin duplicados, cada tipo de comprobante que tuvo movimiento
 * en cuentas con alguno de los prefijos dados, a través de todos los
 * meses del periodo — para que el usuario decida cuáles representan
 * documentos reales (compras) y cuáles son asientos internos (ej.
 * traspaso de inventario a costo de venta) que no deben contarse. */
export async function getTiposComprobantePorPrefijoDelPeriodo(
  clienteId: number, anio: number, meses: number[], prefijos: string[], convencion: ConvencionSaldo,
): Promise<TipoComprobanteConValor[]> {
  const porTipo = new Map<string, { cantidad: number; valor: number }>();
  for (const mes of meses) {
    const carga = await getCargaConArchivo(clienteId, anio, mes);
    if (!carga?.fileKey) continue;
    const buffer = await storageGetBuffer(carga.fileKey);
    const saldosDelMes = sumarSaldosPorCuentaYTipo(buffer, prefijos, convencion);
    for (const { tipo, valor } of Array.from(saldosDelMes.values())) {
      if (!porTipo.has(tipo)) porTipo.set(tipo, { cantidad: 0, valor: 0 });
      const entrada = porTipo.get(tipo)!;
      entrada.cantidad++;
      entrada.valor += valor;
    }
  }
  return Array.from(porTipo.entries())
    .map(([tipo, d]) => ({ tipo, cantidad: d.cantidad, valor: d.valor }))
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
}

/** Igual que `getCuentasPrefijoDelPeriodo`, pero excluyendo del cálculo
 * las líneas cuyo tipo de comprobante esté en `tiposExcluidos` — para
 * dejar fuera los asientos internos de costo de venta u otros
 * movimientos que no son compras reales, antes de sumar el saldo final
 * de cada cuenta. */
export async function getCuentasPrefijoConFiltroDelPeriodo(
  clienteId: number, anio: number, meses: number[], prefijos: string[], tiposExcluidos: string[], convencion: ConvencionSaldo,
): Promise<CuentaIvaResumen[]> {
  const excluidosSet = new Set(tiposExcluidos.map(t => t.trim()));
  const totalPorCuenta = new Map<string, number>();
  for (const mes of meses) {
    const carga = await getCargaConArchivo(clienteId, anio, mes);
    if (!carga?.fileKey) continue;
    const buffer = await storageGetBuffer(carga.fileKey);
    const saldosDelMes = sumarSaldosPorCuentaYTipo(buffer, prefijos, convencion);
    for (const { cuenta, tipo, valor } of Array.from(saldosDelMes.values())) {
      if (excluidosSet.has(tipo)) continue;
      totalPorCuenta.set(cuenta, (totalPorCuenta.get(cuenta) || 0) + valor);
    }
  }
  if (totalPorCuenta.size === 0) return [];

  const cuentas = Array.from(totalPorCuenta.keys());
  const db = await getDb();
  let nombrePorCuentaCliente = new Map<string, string>();
  let nombrePorCuentaPuc = new Map<string, string | null>();
  if (db) {
    const [nombresCliente, nombresPuc] = await Promise.all([
      db.select().from(informesCuentasCliente).where(and(eq(informesCuentasCliente.clienteId, clienteId), inArray(informesCuentasCliente.cuenta, cuentas))),
      db.select().from(informesCuentasPuc).where(inArray(informesCuentasPuc.cuenta, cuentas)),
    ]);
    nombrePorCuentaCliente = new Map(nombresCliente.map(n => [n.cuenta, n.nombre]));
    nombrePorCuentaPuc = new Map(nombresPuc.map(n => [n.cuenta, n.descripcion]));
  }

  return cuentas
    .map(cuenta => ({
      cuenta, valor: totalPorCuenta.get(cuenta) || 0,
      nombre: nombrePorCuentaCliente.get(cuenta) || nombrePorCuentaPuc.get(cuenta) || "(sin nombre)",
    }))
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));
}

export type CuentaIvaResumen = { cuenta: string; nombre: string; valor: number };

/** Lista las cuentas que empiezan con alguno de los prefijos dados (por
 * defecto, familia de la 24 — impuestos, gravámenes y tasas por pagar)
 * con su saldo sumado a través de todos los meses del periodo — para
 * que el usuario elija de una lista real cuál es la cuenta de IVA
 * generado 19%, cuál la de 5%, etc., en vez de escribir el codigo a
 * mano. */
export type DiagnosticoCuentasPeriodo = {
  cuentas: CuentaIvaResumen[];
  mesesConArchivo: number;
  mesesConColumnaCuentaConfiable: number;
  totalMeses: number;
};

/** Igual que `getCuentasPrefijoDelPeriodo`, pero además informa CUÁNTOS
 * meses del periodo tenían el libro auxiliar cargado, y de esos,
 * cuántos tenían una columna de código de cuenta reconocible — para
 * poder explicar en la interfaz POR QUÉ no aparece ninguna cuenta,
 * en vez de un simple "no se encontraron cuentas" sin más contexto. */
export async function getCuentasPrefijoDelPeriodoConDiagnostico(
  clienteId: number, anio: number, meses: number[], prefijos: string[] = ["24"],
): Promise<DiagnosticoCuentasPeriodo> {
  const totalPorCuenta = new Map<string, number>();
  let mesesConArchivo = 0;
  let mesesConColumnaCuentaConfiable = 0;
  for (const mes of meses) {
    const carga = await getCargaConArchivo(clienteId, anio, mes);
    if (!carga?.fileKey) continue;
    mesesConArchivo++;
    const buffer = await storageGetBuffer(carga.fileKey);
    const saldosDelMes = sumarSaldosPorCuenta(buffer, prefijos);
    if (columnaCuentaDelArchivoEsConfiable(buffer)) mesesConColumnaCuentaConfiable++;
    for (const [cuenta, valor] of Array.from(saldosDelMes.entries())) {
      totalPorCuenta.set(cuenta, (totalPorCuenta.get(cuenta) || 0) + valor);
    }
  }
  const cuentas = await nombrarCuentas(clienteId, totalPorCuenta);
  return { cuentas, mesesConArchivo, mesesConColumnaCuentaConfiable, totalMeses: meses.length };
}

/** Confirma si el archivo, tal como está, tiene una columna de cuenta
 * reconocible y confiable — usado solo para el diagnóstico de arriba. */
function columnaCuentaDelArchivoEsConfiable(buffer: Buffer): boolean {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (filas.length < 2) return false;
  const cols: ColsAuxiliarDian = resolverColumnasAuxiliarDian(filas[0]);
  return cols.cuenta !== null && columnaCuentaEsConfiable(filas, cols.cuenta);
}

async function nombrarCuentas(clienteId: number, totalPorCuenta: Map<string, number>): Promise<CuentaIvaResumen[]> {
  if (totalPorCuenta.size === 0) return [];
  const cuentas = Array.from(totalPorCuenta.keys());
  const db = await getDb();
  let nombrePorCuentaCliente = new Map<string, string>();
  let nombrePorCuentaPuc = new Map<string, string | null>();
  if (db) {
    const [nombresCliente, nombresPuc] = await Promise.all([
      db.select().from(informesCuentasCliente).where(and(eq(informesCuentasCliente.clienteId, clienteId), inArray(informesCuentasCliente.cuenta, cuentas))),
      db.select().from(informesCuentasPuc).where(inArray(informesCuentasPuc.cuenta, cuentas)),
    ]);
    nombrePorCuentaCliente = new Map(nombresCliente.map(n => [n.cuenta, n.nombre]));
    nombrePorCuentaPuc = new Map(nombresPuc.map(n => [n.cuenta, n.descripcion]));
  }
  return cuentas
    .map(cuenta => ({
      cuenta, valor: totalPorCuenta.get(cuenta) || 0,
      nombre: nombrePorCuentaCliente.get(cuenta) || nombrePorCuentaPuc.get(cuenta) || "(sin nombre)",
    }))
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));
}

export async function getCuentasPrefijoDelPeriodo(
  clienteId: number, anio: number, meses: number[], prefijos: string[] = ["24"],
): Promise<CuentaIvaResumen[]> {
  const diagnostico = await getCuentasPrefijoDelPeriodoConDiagnostico(clienteId, anio, meses, prefijos);
  return diagnostico.cuentas;
}

/** Suma el saldo de una cuenta ESPECIFICA (codigo exacto) a traves de
 * todos los meses del periodo — usado para leer el valor real de la
 * cuenta que el cliente ya configuro como "IVA generado 19%", etc. */
export async function getSaldoCuentaEnPeriodo(clienteId: number, anio: number, meses: number[], cuenta: string): Promise<number> {
  let total = 0;
  for (const mes of meses) {
    const carga = await getCargaConArchivo(clienteId, anio, mes);
    if (!carga?.fileKey) continue;
    const buffer = await storageGetBuffer(carga.fileKey);
    const saldosDelMes = sumarSaldosPorCuenta(buffer, [cuenta]);
    total += saldosDelMes.get(cuenta) || 0;
  }
  return total;
}

export async function getConfigCuentasIva(clienteId: number): Promise<InformeConfigCuentaIva[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(informesConfigCuentasIva).where(eq(informesConfigCuentasIva.clienteId, clienteId));
}

/** Guarda (o corrige) que cuenta corresponde a cada rol de IVA para este
 * cliente — se reutiliza en todos los periodos futuros. */
export async function guardarConfigCuentasIva(clienteId: number, configs: { tipoIva: TipoIva; cuenta: string }[], userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const c of configs) {
    if (!c.cuenta.trim()) continue;
    const existente = await db.select().from(informesConfigCuentasIva)
      .where(and(eq(informesConfigCuentasIva.clienteId, clienteId), eq(informesConfigCuentasIva.tipoIva, c.tipoIva))).limit(1);
    if (existente.length > 0) {
      await db.update(informesConfigCuentasIva).set({ cuenta: c.cuenta, actualizadoPorId: userId }).where(eq(informesConfigCuentasIva.id, existente[0].id));
    } else {
      await db.insert(informesConfigCuentasIva).values({ clienteId, tipoIva: c.tipoIva, cuenta: c.cuenta, actualizadoPorId: userId });
    }
  }
}

export async function getComprasTiposExcluidos(clienteId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const filas = await db.select().from(informesComprasTiposExcluidos).where(eq(informesComprasTiposExcluidos.clienteId, clienteId));
  return filas.map(f => f.tipoComprobante);
}

/** Reemplaza la lista completa de tipos de comprobante que este cliente
 * excluye del Paso 4 de IVA (compras, cuentas 14/62) — asientos de
 * costo de venta u otros movimientos que no son compras reales. */
export async function guardarComprasTiposExcluidos(clienteId: number, tipos: string[], userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(informesComprasTiposExcluidos).where(eq(informesComprasTiposExcluidos.clienteId, clienteId));
  for (const tipo of tipos) {
    if (!tipo.trim()) continue;
    await db.insert(informesComprasTiposExcluidos).values({ clienteId, tipoComprobante: tipo.trim(), actualizadoPorId: userId });
  }
}
