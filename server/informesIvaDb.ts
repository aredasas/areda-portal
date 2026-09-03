import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { informesCargas, informesReportes, informesIvaConciliacion } from "../drizzle/schema";

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
