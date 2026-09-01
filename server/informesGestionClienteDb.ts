import { and, eq, gte, lte, inArray } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { getDb } from "./db";
import {
  clients, tasks, taxDeadlines, taxObligations, comments, historyEvents,
  informesCargas, informesReportes, users,
} from "../drizzle/schema";
import { dibujarPiePaginaAreda } from "./rentaDb";

export type ActividadGestionCliente = {
  fecha: Date;
  tipo:
    | "tarea_completada" | "tarea_comentario" | "tarea_revision"
    | "vencimiento_completado" | "vencimiento_comentario" | "vencimiento_revision"
    | "carga_auxiliar" | "reporte_generado";
  titulo: string;
  detalle: string | null;
  usuario: string;
};

const NOMBRES_REPORTE: Record<string, string> = {
  ERM: "Estado de Resultados Mensual",
  ERI: "Estado de Resultados por Centro de Costo (ERI)",
  DIAN: "Comparación DIAN vs. contabilidad",
};

const NOMBRES_EVENTO_HISTORIAL: Record<string, string> = {
  creada: "creada",
  completada: "marcada como completada",
  correccion_solicitada: "devuelta para corrección",
  aprobada: "aprobada en revisión",
  reabierta: "reabierta",
  cancelada: "cancelada",
};

/** Recopila, en orden cronológico, todo lo que se hizo para un cliente
 * dentro de un rango de fechas: tareas y vencimientos completados,
 * comentarios y eventos de revisión sobre ellos, cargas de libro auxiliar,
 * y generación/descarga de reportes (ERM/ERI/comparación DIAN). Esto
 * alimenta el informe de "Gestión Cliente" que se entrega al cliente. */
export async function getActividadesGestionCliente(
  clienteId: number, fechaInicio: Date, fechaFin: Date,
): Promise<ActividadGestionCliente[]> {
  const db = await getDb();
  if (!db) return [];

  const actividades: ActividadGestionCliente[] = [];
  const nombreUsuario = new Map<number, string>();
  const resolverUsuario = async (id: number | null): Promise<string> => {
    if (id == null) return "Sistema";
    if (nombreUsuario.has(id)) return nombreUsuario.get(id)!;
    const fila = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
    const nombre = fila[0]?.name || "Usuario";
    nombreUsuario.set(id, nombre);
    return nombre;
  };

  // ---- Tareas completadas en el periodo ----
  const tareasCompletadas = await db.select().from(tasks).where(and(
    eq(tasks.clientId, clienteId), gte(tasks.completedAt, fechaInicio), lte(tasks.completedAt, fechaFin),
  ));
  for (const t of tareasCompletadas) {
    actividades.push({
      fecha: t.completedAt!, tipo: "tarea_completada", titulo: t.title,
      detalle: t.completionNotes, usuario: await resolverUsuario(t.completedById),
    });
  }

  // ---- Vencimientos tributarios completados en el periodo ----
  const vencimientosCompletados = await db.select({
    id: taxDeadlines.id, period: taxDeadlines.period, completedAt: taxDeadlines.completedAt,
    completedById: taxDeadlines.completedById, obligationName: taxObligations.name,
  })
    .from(taxDeadlines)
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .where(and(eq(taxDeadlines.clientId, clienteId), gte(taxDeadlines.completedAt, fechaInicio), lte(taxDeadlines.completedAt, fechaFin)));
  for (const v of vencimientosCompletados) {
    actividades.push({
      fecha: v.completedAt!, tipo: "vencimiento_completado",
      titulo: `${v.obligationName} — periodo ${v.period}`, detalle: null,
      usuario: await resolverUsuario(v.completedById),
    });
  }

  // ---- Comentarios y revisiones sobre las tareas/vencimientos de este cliente ----
  // Se toman TODAS las tareas/vencimientos del cliente (no solo los
  // completados en el periodo) porque un comentario o una revisión puede
  // caer dentro del periodo aunque la tarea se haya completado antes o
  // después.
  const todasTareas = await db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.clientId, clienteId));
  const todosVencimientos = await db.select({ id: taxDeadlines.id, period: taxDeadlines.period, obligationName: taxObligations.name })
    .from(taxDeadlines).innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .where(eq(taxDeadlines.clientId, clienteId));

  const tituloTarea = new Map(todasTareas.map(t => [t.id, t.title]));
  const tituloVencimiento = new Map(todosVencimientos.map(v => [v.id, `${v.obligationName} — periodo ${v.period}`]));
  const idsTareas = todasTareas.map(t => t.id);
  const idsVencimientos = todosVencimientos.map(v => v.id);

  if (idsTareas.length > 0) {
    const comentariosTareas = await db.select().from(comments).where(and(
      eq(comments.entityType, "task"), inArray(comments.entityId, idsTareas),
      gte(comments.createdAt, fechaInicio), lte(comments.createdAt, fechaFin),
    ));
    for (const c of comentariosTareas) {
      actividades.push({
        fecha: c.createdAt, tipo: "tarea_comentario",
        titulo: tituloTarea.get(c.entityId) || "Tarea", detalle: c.content,
        usuario: await resolverUsuario(c.authorId),
      });
    }

    const eventosTareas = await db.select().from(historyEvents).where(and(
      eq(historyEvents.entityType, "task"), inArray(historyEvents.entityId, idsTareas),
      gte(historyEvents.createdAt, fechaInicio), lte(historyEvents.createdAt, fechaFin),
    ));
    for (const e of eventosTareas) {
      if (e.eventType === "creada") continue; // ruido — no aporta al cliente
      actividades.push({
        fecha: e.createdAt, tipo: "tarea_revision",
        titulo: `${tituloTarea.get(e.entityId) || "Tarea"} — ${NOMBRES_EVENTO_HISTORIAL[e.eventType] || e.eventType}`,
        detalle: e.notes, usuario: await resolverUsuario(e.userId),
      });
    }
  }

  if (idsVencimientos.length > 0) {
    const comentariosVencimientos = await db.select().from(comments).where(and(
      eq(comments.entityType, "deadline"), inArray(comments.entityId, idsVencimientos),
      gte(comments.createdAt, fechaInicio), lte(comments.createdAt, fechaFin),
    ));
    for (const c of comentariosVencimientos) {
      actividades.push({
        fecha: c.createdAt, tipo: "vencimiento_comentario",
        titulo: tituloVencimiento.get(c.entityId) || "Vencimiento", detalle: c.content,
        usuario: await resolverUsuario(c.authorId),
      });
    }

    const eventosVencimientos = await db.select().from(historyEvents).where(and(
      eq(historyEvents.entityType, "deadline"), inArray(historyEvents.entityId, idsVencimientos),
      gte(historyEvents.createdAt, fechaInicio), lte(historyEvents.createdAt, fechaFin),
    ));
    for (const e of eventosVencimientos) {
      if (e.eventType === "creada") continue;
      actividades.push({
        fecha: e.createdAt, tipo: "vencimiento_revision",
        titulo: `${tituloVencimiento.get(e.entityId) || "Vencimiento"} — ${NOMBRES_EVENTO_HISTORIAL[e.eventType] || e.eventType}`,
        detalle: e.notes, usuario: await resolverUsuario(e.userId),
      });
    }
  }

  // ---- Cargas de libro auxiliar (módulo Informes) ----
  const cargas = await db.select().from(informesCargas).where(and(
    eq(informesCargas.clienteId, clienteId), gte(informesCargas.createdAt, fechaInicio), lte(informesCargas.createdAt, fechaFin),
  ));
  for (const c of cargas) {
    if (c.estado !== "completado") continue; // no reportar intentos fallidos al cliente
    actividades.push({
      fecha: c.createdAt, tipo: "carga_auxiliar",
      titulo: "Cargue de libro auxiliar", detalle: `Archivo: ${c.nombreArchivo} (${c.mes}/${c.anio})`,
      usuario: await resolverUsuario(c.cargadoPorId),
    });
  }

  // ---- Generación/descarga de reportes (ERM, ERI, comparación DIAN) ----
  const reportes = await db.select().from(informesReportes).where(and(
    eq(informesReportes.clienteId, clienteId), gte(informesReportes.createdAt, fechaInicio), lte(informesReportes.createdAt, fechaFin),
  ));
  for (const r of reportes) {
    const nombre = NOMBRES_REPORTE[r.tipo] || r.tipo;
    actividades.push({
      fecha: r.createdAt, tipo: "reporte_generado",
      titulo: `Generación de ${nombre}`, detalle: r.mes ? `Periodo: ${r.mes}/${r.anio}` : `Año: ${r.anio}`,
      usuario: await resolverUsuario(r.generadoPorId),
    });
  }

  actividades.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  return actividades;
}

const ETIQUETAS_TIPO: Record<ActividadGestionCliente["tipo"], string> = {
  tarea_completada: "Tarea realizada",
  tarea_comentario: "Comentario en tarea",
  tarea_revision: "Revisión de tarea",
  vencimiento_completado: "Vencimiento tributario cumplido",
  vencimiento_comentario: "Comentario en vencimiento",
  vencimiento_revision: "Revisión de vencimiento",
  carga_auxiliar: "Cargue de libro auxiliar",
  reporte_generado: "Generación de informe",
};

/** Genera el PDF de "Gestión Cliente" — un informe con destino al cliente
 * que resume, en orden cronológico, todo lo que se hizo por su cuenta
 * durante el periodo seleccionado: tareas, vencimientos tributarios,
 * comentarios y revisiones registradas, cargues de libro auxiliar, y
 * generación de reportes contables. Mismo estilo visual (logo al pie)
 * que los demás documentos que se entregan al cliente. */
export async function generarInformeGestionCliente(
  clienteNombre: string, clienteNit: string, fechaInicio: Date, fechaFin: Date,
  actividades: ActividadGestionCliente[],
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: "letter", margin: 50 });
  const done = new Promise<Buffer>((resolve) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  const xLabel = doc.page.margins.left;
  const anchoUtil = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const fmtFecha = (d: Date) => d.toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric" });
  const fmtFechaHora = (d: Date) => d.toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });

  // ---- Encabezado ----
  doc.font("Helvetica-Bold").fontSize(16).text("INFORME DE GESTIÓN AL CLIENTE", { align: "center" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(9).fillColor("#555555")
    .text(`Generado el ${fmtFecha(new Date())}`, { align: "center" });
  doc.fillColor("#000000");
  doc.moveDown(1);

  doc.font("Helvetica-Bold").fontSize(11).text("Cliente:", { continued: true }).font("Helvetica").text(` ${clienteNombre}`);
  doc.font("Helvetica-Bold").text("NIT:", { continued: true }).font("Helvetica").text(` ${clienteNit}`);
  doc.font("Helvetica-Bold").text("Periodo del informe:", { continued: true }).font("Helvetica")
    .text(` ${fmtFecha(fechaInicio)} al ${fmtFecha(fechaFin)}`);
  doc.moveDown(1);

  doc.font("Helvetica").fontSize(10.5).text(
    `Estas son las actividades realizadas durante el periodo para ${clienteNombre}. ` +
    "A continuación se detalla, en orden cronológico, cada tarea, vencimiento tributario, revisión y " +
    "gestión contable adelantada, indicando la fecha y el responsable de cada una.",
    { width: anchoUtil, align: "justify" },
  );
  doc.moveDown(1);

  if (actividades.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor("#777777")
      .text("No se registraron actividades para este cliente durante el periodo seleccionado.");
    doc.fillColor("#000000");
    dibujarPiePaginaAreda(doc);
    doc.end();
    return done;
  }

  doc.font("Helvetica-Bold").fontSize(12).text("Actividades realizadas");
  doc.moveDown(0.4);

  const ALTO_MINIMO_BLOQUE = 55;
  for (const act of actividades) {
    if (doc.y + ALTO_MINIMO_BLOQUE > doc.page.height - doc.page.margins.bottom) {
      dibujarPiePaginaAreda(doc);
      doc.addPage();
    }
    const yInicio = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#42302E").text(fmtFechaHora(act.fecha), xLabel, yInicio, { width: 140 });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#8a6d00")
      .text(ETIQUETAS_TIPO[act.tipo], xLabel + 145, yInicio, { width: anchoUtil - 145 });
    doc.moveDown(0.15);
    doc.font("Helvetica").fontSize(10).fillColor("#000000").text(act.titulo, xLabel, doc.y, { width: anchoUtil });
    if (act.detalle && act.detalle.trim()) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor("#555555")
        .text(act.detalle.trim(), xLabel + 10, doc.y + 1, { width: anchoUtil - 10 });
    }
    doc.font("Helvetica").fontSize(8.5).fillColor("#777777").text(`Responsable: ${act.usuario}`, xLabel + 10, doc.y + 2);
    doc.fillColor("#000000");
    doc.moveDown(0.6);
    doc.moveTo(xLabel, doc.y).lineTo(xLabel + anchoUtil, doc.y).strokeColor("#e5e5e5").stroke();
    doc.moveDown(0.5);
  }

  dibujarPiePaginaAreda(doc);
  doc.end();
  return done;
}
