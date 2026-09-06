import { and, eq, inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { getDb } from "./db";
import { informesConfigCuentasIva, informesCuentasCliente, informesCuentasPuc, type InformeConfigCuentaIva } from "../drizzle/schema";
import { getCargaConArchivo } from "./informesDb";
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

/** Lee el libro auxiliar (mismo archivo ya cargado para Estado de
 * Resultados/Comparación DIAN) y suma el saldo de CADA cuenta que
 * empiece con alguno de los prefijos dados — para cuentas de balance
 * (como la 2408 de IVA) que `informesSaldosMensuales` descarta por
 * completo (esa tabla solo guarda ingreso/costo/gasto, cuentas 4/5/6).
 * Convencion debito-credito de pasivo: el saldo aumenta con el credito
 * y disminuye con el debito. */
function sumarSaldosPorCuenta(buffer: Buffer, prefijos: string[]): Map<string, number> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  if (filas.length < 2) return new Map();

  const cols: ColsAuxiliarDian = resolverColumnasAuxiliarDian(filas[0]);
  if (cols.cuenta === null) return new Map();

  const saldos = new Map<string, number>();
  for (let i = 1; i < filas.length; i++) {
    const values = filas[i];
    if (!values) continue;
    const cuentaRaw = String(values[cols.cuenta] ?? "").trim();
    if (!cuentaRaw || !prefijos.some(p => cuentaRaw.startsWith(p))) continue;
    const debito = Number(values[cols.debito]) || 0;
    const credito = Number(values[cols.credito]) || 0;
    saldos.set(cuentaRaw, (saldos.get(cuentaRaw) || 0) + (credito - debito));
  }
  return saldos;
}

export type CuentaIvaResumen = { cuenta: string; nombre: string; valor: number };

/** Lista las cuentas que empiezan con alguno de los prefijos dados (por
 * defecto, familia de la 24 — impuestos, gravámenes y tasas por pagar)
 * con su saldo sumado a través de todos los meses del periodo — para
 * que el usuario elija de una lista real cuál es la cuenta de IVA
 * generado 19%, cuál la de 5%, etc., en vez de escribir el codigo a
 * mano. */
export async function getCuentasPrefijoDelPeriodo(
  clienteId: number, anio: number, meses: number[], prefijos: string[] = ["24"],
): Promise<CuentaIvaResumen[]> {
  const totalPorCuenta = new Map<string, number>();
  for (const mes of meses) {
    const carga = await getCargaConArchivo(clienteId, anio, mes);
    if (!carga?.fileKey) continue;
    const buffer = await storageGetBuffer(carga.fileKey);
    const saldosDelMes = sumarSaldosPorCuenta(buffer, prefijos);
    for (const [cuenta, valor] of Array.from(saldosDelMes.entries())) {
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
