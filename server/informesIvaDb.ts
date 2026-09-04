import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  informesCargas, informesReportes, informesIvaConciliacion,
  informesSaldosMensuales, informesClasificacionCuentas, informesCuentasCliente, informesCuentasPuc,
  informesDivisionesCuentaIva,
} from "../drizzle/schema";

export type Periodicidad = "bimestral" | "cuatrimestral" | "anual";

/** Códigos y nombres de periodo del Formulario 300 de la DIAN — tabla
 * tomada literalmente del instructivo del formulario (casilla 3). El
 * régimen SIMPLE declara IVA anualmente con código "01" — mismo
 * formulario, periodicidad distinta. */
export const PERIODOS_IVA: Record<Periodicidad, { codigo: number; nombre: string; meses: number[] }[]> = {
  bimestral: [
    { codigo: 1, nombre: "Enero - Febrero", meses: [1, 2] },
    { codigo: 2, nombre: "Marzo - Abril", meses: [3, 4] },
    { codigo: 3, nombre: "Mayo - Junio", meses: [5, 6] },
    { codigo: 4, nombre: "Julio - Agosto", meses: [7, 8] },
    { codigo: 5, nombre: "Septiembre - Octubre", meses: [9, 10] },
    { codigo: 6, nombre: "Noviembre - Diciembre", meses: [11, 12] },
  ],
  cuatrimestral: [
    { codigo: 1, nombre: "Enero - Abril", meses: [1, 2, 3, 4] },
    { codigo: 2, nombre: "Mayo - Agosto", meses: [5, 6, 7, 8] },
    { codigo: 3, nombre: "Septiembre - Diciembre", meses: [9, 10, 11, 12] },
  ],
  anual: [
    { codigo: 1, nombre: "Enero - Diciembre (Régimen Simple)", meses: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  ],
};

export function mesesDelPeriodo(periodicidad: Periodicidad, codigoPeriodo: number): number[] {
  const encontrado = PERIODOS_IVA[periodicidad].find(p => p.codigo === codigoPeriodo);
  if (!encontrado) throw new Error(`Periodo ${codigoPeriodo} no válido para periodicidad ${periodicidad}`);
  return encontrado.meses;
}

const NOMBRES_MES = ["", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export type EstadoMesIva = {
  mes: number;
  nombreMes: string;
  tieneLibroAuxiliar: boolean;
  tieneComparacionDian: boolean;
  listo: boolean;
};

/** Antes de empezar a conciliar el IVA de un periodo, hace falta tener
 * cargado el libro auxiliar de CADA mes del periodo (ya que ahí está la
 * base de ingresos/compras/IVA por cuenta), y haber generado al menos
 * una comparación DIAN de ese mes (ahí está la verificación cruzada de
 * lo que la DIAN ya tiene reportado electrónicamente). Sin esto, la
 * conciliación de IVA partiría de información incompleta. */
export async function verificarPrerequisitosIva(
  clienteId: number, anio: number, periodicidad: Periodicidad, codigoPeriodo: number,
): Promise<{ meses: EstadoMesIva[]; todoListo: boolean }> {
  const db = await getDb();
  const meses = mesesDelPeriodo(periodicidad, codigoPeriodo);
  const estadoMeses: EstadoMesIva[] = [];

  for (const mes of meses) {
    let tieneLibroAuxiliar = false;
    let tieneComparacionDian = false;
    if (db) {
      const cargas = await db.select().from(informesCargas)
        .where(and(eq(informesCargas.clienteId, clienteId), eq(informesCargas.anio, anio), eq(informesCargas.mes, mes), eq(informesCargas.estado, "completado")));
      tieneLibroAuxiliar = cargas.length > 0;

      const reportesDian = await db.select().from(informesReportes)
        .where(and(eq(informesReportes.clienteId, clienteId), eq(informesReportes.anio, anio), eq(informesReportes.mes, mes), eq(informesReportes.tipo, "DIAN")));
      tieneComparacionDian = reportesDian.length > 0;
    }
    estadoMeses.push({ mes, nombreMes: NOMBRES_MES[mes], tieneLibroAuxiliar, tieneComparacionDian, listo: tieneLibroAuxiliar && tieneComparacionDian });
  }

  return { meses: estadoMeses, todoListo: estadoMeses.every(m => m.listo) };
}

/** Crea el expediente de conciliación de IVA para este periodo si no
 * existe todavía, o devuelve el que ya había — nunca se pisa un
 * expediente existente (para no perder el avance ya guardado en pasos
 * anteriores). */
export async function iniciarOConseguirConciliacion(
  clienteId: number, anio: number, periodicidad: Periodicidad, codigoPeriodo: number, userId: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const existente = await db.select().from(informesIvaConciliacion).where(and(
    eq(informesIvaConciliacion.clienteId, clienteId), eq(informesIvaConciliacion.anio, anio),
    eq(informesIvaConciliacion.periodicidad, periodicidad), eq(informesIvaConciliacion.periodo, codigoPeriodo),
  )).limit(1);
  if (existente.length > 0) return existente[0];

  const result = await db.insert(informesIvaConciliacion).values({
    clienteId, anio, periodicidad, periodo: codigoPeriodo, actualizadoPorId: userId,
  });
  const id = Number((result as any).insertId ?? (result as any)[0]?.insertId);
  const filas = await db.select().from(informesIvaConciliacion).where(eq(informesIvaConciliacion.id, id)).limit(1);
  return filas[0];
}

export async function getConciliacionIva(
  clienteId: number, anio: number, periodicidad: Periodicidad, codigoPeriodo: number,
) {
  const db = await getDb();
  if (!db) return undefined;
  const filas = await db.select().from(informesIvaConciliacion).where(and(
    eq(informesIvaConciliacion.clienteId, clienteId), eq(informesIvaConciliacion.anio, anio),
    eq(informesIvaConciliacion.periodicidad, periodicidad), eq(informesIvaConciliacion.periodo, codigoPeriodo),
  )).limit(1);
  return filas[0];
}

// ==================== PASO 2: CLASIFICACIÓN DE INGRESOS ====================

export type ClasificacionIva = "gravado_19" | "gravado_5" | "excluido" | "no_gravado";

export type DivisionCuenta = {
  orden: number;
  etiqueta: string | null;
  valor: number;
  clasificacion: ClasificacionIva;
  facturado: boolean;
};

export type CuentaResumenPeriodo = {
  cuenta: string;
  nombre: string;
  valor: number;
  clasificacion: ClasificacionIva | null;
  facturado: boolean;
  /** Si tiene divisiones para ESTE periodo, la cuenta se trata como
   * varias sub-partidas (cada una con su propia tarifa y si está
   * facturada), en vez de una sola clasificación — típico cuando una
   * cuenta mezcla ingreso gravado y excluido sin cuentas separadas. */
  divisiones: DivisionCuenta[];
};

/** Cuentas de ingreso (cuenta 4, ya identificadas como tipo "ingreso" al
 * cargar el libro auxiliar) que tuvieron movimiento en los meses del
 * periodo, sumadas entre todos los centros de costo — con la
 * clasificación tributaria ya guardada para este cliente, si existe, y
 * las divisiones (si las hay) guardadas para este periodo específico. */
export async function getCuentasIngresoDelPeriodo(
  clienteId: number, anio: number, meses: number[], periodicidad: Periodicidad, periodo: number,
): Promise<CuentaResumenPeriodo[]> {
  const db = await getDb();
  if (!db) return [];
  const saldos = await db.select().from(informesSaldosMensuales).where(and(
    eq(informesSaldosMensuales.clienteId, clienteId), eq(informesSaldosMensuales.anio, anio),
    inArray(informesSaldosMensuales.mes, meses), eq(informesSaldosMensuales.tipo, "ingreso"),
  ));
  if (saldos.length === 0) return [];

  const totalPorCuenta = new Map<string, number>();
  for (const s of saldos) totalPorCuenta.set(s.cuenta, (totalPorCuenta.get(s.cuenta) || 0) + s.valor);
  const cuentas = Array.from(totalPorCuenta.keys());

  const [nombresCliente, nombresPuc, clasificaciones, divisionesGuardadas] = await Promise.all([
    db.select().from(informesCuentasCliente).where(and(eq(informesCuentasCliente.clienteId, clienteId), inArray(informesCuentasCliente.cuenta, cuentas))),
    db.select().from(informesCuentasPuc).where(inArray(informesCuentasPuc.cuenta, cuentas)),
    db.select().from(informesClasificacionCuentas).where(and(eq(informesClasificacionCuentas.clienteId, clienteId), inArray(informesClasificacionCuentas.cuenta, cuentas))),
    db.select().from(informesDivisionesCuentaIva).where(and(
      eq(informesDivisionesCuentaIva.clienteId, clienteId), eq(informesDivisionesCuentaIva.anio, anio),
      eq(informesDivisionesCuentaIva.periodicidad, periodicidad), eq(informesDivisionesCuentaIva.periodo, periodo),
      inArray(informesDivisionesCuentaIva.cuenta, cuentas),
    )),
  ]);
  const nombrePorCuentaCliente = new Map(nombresCliente.map(n => [n.cuenta, n.nombre]));
  const nombrePorCuentaPuc = new Map(nombresPuc.map(n => [n.cuenta, n.descripcion]));
  const clasifPorCuenta = new Map(clasificaciones.map(c => [c.cuenta, c]));
  const divisionesPorCuenta = new Map<string, DivisionCuenta[]>();
  for (const d of divisionesGuardadas) {
    if (!divisionesPorCuenta.has(d.cuenta)) divisionesPorCuenta.set(d.cuenta, []);
    divisionesPorCuenta.get(d.cuenta)!.push({
      orden: d.orden, etiqueta: d.etiqueta, valor: d.valor,
      clasificacion: d.clasificacion as ClasificacionIva, facturado: d.facturado,
    });
  }

  return cuentas
    .map(cuenta => {
      const config = clasifPorCuenta.get(cuenta);
      const divisiones = (divisionesPorCuenta.get(cuenta) || []).sort((a, b) => a.orden - b.orden);
      return {
        cuenta, valor: totalPorCuenta.get(cuenta) || 0,
        nombre: nombrePorCuentaCliente.get(cuenta) || nombrePorCuentaPuc.get(cuenta) || "(sin nombre)",
        clasificacion: (config?.clasificacion as ClasificacionIva) ?? null,
        facturado: config?.facturado ?? true,
        divisiones,
      };
    })
    .sort((a, b) => a.cuenta.localeCompare(b.cuenta));
}

/** Guarda (o corrige) la clasificación tributaria — y si está facturada —
 * de una o varias cuentas para este cliente — queda disponible también
 * para los siguientes periodos, sin tener que reclasificar cada vez. */
export async function guardarClasificacionCuentas(
  clienteId: number, clasificaciones: { cuenta: string; clasificacion: ClasificacionIva; facturado: boolean }[], userId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const c of clasificaciones) {
    const existente = await db.select().from(informesClasificacionCuentas)
      .where(and(eq(informesClasificacionCuentas.clienteId, clienteId), eq(informesClasificacionCuentas.cuenta, c.cuenta))).limit(1);
    if (existente.length > 0) {
      await db.update(informesClasificacionCuentas)
        .set({ clasificacion: c.clasificacion, facturado: c.facturado, actualizadoPorId: userId })
        .where(eq(informesClasificacionCuentas.id, existente[0].id));
    } else {
      await db.insert(informesClasificacionCuentas).values({ clienteId, cuenta: c.cuenta, clasificacion: c.clasificacion, facturado: c.facturado, actualizadoPorId: userId });
    }
  }
}

/** Divide el valor de una cuenta, PARA ESTE PERIODO, en dos o más partes
 * (ej. 70% gravado al 19% y 30% excluido) — cada parte con su propia
 * tarifa y si está facturada. Reemplaza cualquier división anterior de
 * esa cuenta en este mismo periodo. Pasar un array vacío elimina la
 * división (la cuenta vuelve a su clasificación simple). */
export async function guardarDivisionesCuenta(
  clienteId: number, anio: number, periodicidad: Periodicidad, periodo: number, cuenta: string,
  divisiones: { etiqueta?: string; valor: number; clasificacion: ClasificacionIva; facturado: boolean }[],
  userId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.delete(informesDivisionesCuentaIva).where(and(
    eq(informesDivisionesCuentaIva.clienteId, clienteId), eq(informesDivisionesCuentaIva.anio, anio),
    eq(informesDivisionesCuentaIva.periodicidad, periodicidad), eq(informesDivisionesCuentaIva.periodo, periodo),
    eq(informesDivisionesCuentaIva.cuenta, cuenta),
  ));
  for (let i = 0; i < divisiones.length; i++) {
    const d = divisiones[i];
    await db.insert(informesDivisionesCuentaIva).values({
      clienteId, anio, periodicidad, periodo, cuenta, orden: i,
      etiqueta: d.etiqueta || null, valor: d.valor, clasificacion: d.clasificacion, facturado: d.facturado,
      actualizadoPorId: userId,
    });
  }
}

/** Total de ingresos que la DIAN reporta como "Emitidos" para cada mes
 * del periodo — se toma de la comparación DIAN que ya se generó en cada
 * mes (guardada ahí desde que se genera, sin volver a pedir el archivo).
 * Si algún mes tiene más de una comparación generada, se usa la más
 * reciente. Devuelve null en los meses donde nunca se guardó ese total
 * (comparaciones generadas antes de que se empezara a guardar). */
export async function getTotalDianEmitidoPorMes(clienteId: number, anio: number, meses: number[]): Promise<{ mes: number; totalEmitidoDian: number | null }[]> {
  const db = await getDb();
  if (!db) return meses.map(mes => ({ mes, totalEmitidoDian: null }));
  const reportes = await db.select().from(informesReportes).where(and(
    eq(informesReportes.clienteId, clienteId), eq(informesReportes.anio, anio),
    inArray(informesReportes.mes, meses), eq(informesReportes.tipo, "DIAN"),
  ));
  const porMes = new Map<number, { totalEmitidoDian: number | null; createdAt: Date }>();
  for (const r of reportes) {
    const actual = porMes.get(r.mes!);
    if (!actual || r.createdAt > actual.createdAt) porMes.set(r.mes!, { totalEmitidoDian: r.totalEmitidoDian, createdAt: r.createdAt });
  }
  return meses.map(mes => ({ mes, totalEmitidoDian: porMes.get(mes)?.totalEmitidoDian ?? null }));
}

/** Guarda el resumen del paso "ingresos" dentro del expediente de la
 * conciliación (subtotales por tarifa + comparación contra la DIAN) —
 * se fusiona con lo que ya hubiera en `estadoJson` de otros pasos, para
 * no perder el avance de las fases siguientes cuando estén listas. */
/** Desglosa una cuenta en sus líneas de cálculo — si tiene divisiones
 * para este periodo, cada división es una línea independiente con su
 * propia tarifa y si está facturada; si no, la cuenta entera es una
 * sola línea con su clasificación simple. Se usa para sumar subtotales
 * sin tener que repetir esta lógica en cada consumidor. */
export function desglosarCuenta(cuenta: CuentaResumenPeriodo): { valor: number; clasificacion: ClasificacionIva | null; facturado: boolean }[] {
  if (cuenta.divisiones.length > 0) {
    return cuenta.divisiones.map(d => ({ valor: d.valor, clasificacion: d.clasificacion, facturado: d.facturado }));
  }
  return [{ valor: cuenta.valor, clasificacion: cuenta.clasificacion, facturado: cuenta.facturado }];
}

/** Arma el resumen completo del paso "ingresos" — subtotales por tarifa
 * (sobre TODO el ingreso, se facture o no, porque el Formulario 300 pide
 * el total real) y la comparación contra la DIAN (que SOLO debe usar lo
 * facturado electrónicamente, ya que eso es lo único que puede aparecer
 * del lado de la DIAN) — y lo deja guardado en el expediente. Reutilizado
 * tanto al guardar la clasificación de una cuenta como al guardar una
 * división. */
export async function computarResumenIngresos(
  clienteId: number, anio: number, periodicidad: Periodicidad, periodo: number,
) {
  const meses = mesesDelPeriodo(periodicidad, periodo);
  const [cuentas, totalDianPorMes] = await Promise.all([
    getCuentasIngresoDelPeriodo(clienteId, anio, meses, periodicidad, periodo),
    getTotalDianEmitidoPorMes(clienteId, anio, meses),
  ]);
  const totalPorClasificacion = { gravado_19: 0, gravado_5: 0, excluido: 0, no_gravado: 0 };
  let totalContabilidad = 0;
  let totalContabilidadFacturado = 0;
  for (const c of cuentas) {
    for (const linea of desglosarCuenta(c)) {
      if (linea.clasificacion) totalPorClasificacion[linea.clasificacion] += linea.valor;
      totalContabilidad += linea.valor;
      if (linea.facturado) totalContabilidadFacturado += linea.valor;
    }
  }
  const totalDian = totalDianPorMes.reduce((a, m) => a + (m.totalEmitidoDian ?? 0), 0);
  const resumen = { cuentas, totalPorClasificacion, totalContabilidad, totalContabilidadFacturado, totalDianPorMes, totalDian };
  await guardarPasoIngresos(clienteId, anio, periodicidad, periodo, resumen);
  return resumen;
}

export async function guardarPasoIngresos(
  clienteId: number, anio: number, periodicidad: Periodicidad, codigoPeriodo: number, resumenIngresos: unknown,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existente = await getConciliacionIva(clienteId, anio, periodicidad, codigoPeriodo);
  if (!existente) throw new Error("No existe el expediente de esta conciliación — inicia el periodo primero.");
  let estado: Record<string, unknown> = {};
  try { estado = existente.estadoJson ? JSON.parse(existente.estadoJson) : {}; } catch { estado = {}; }
  estado.ingresos = resumenIngresos;
  await db.update(informesIvaConciliacion).set({ estadoJson: JSON.stringify(estado) }).where(eq(informesIvaConciliacion.id, existente.id));
}
