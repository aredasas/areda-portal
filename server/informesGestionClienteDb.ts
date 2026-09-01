import { and, eq, gte, lte, inArray, asc } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { getDb } from "./db";
import {
  clients, tasks, taxDeadlines, taxObligations, comments, historyEvents,
  informesCargas, informesReportes, users,
} from "../drizzle/schema";
import { dibujarPiePaginaAreda } from "./rentaDb";

export type ComentarioDetalle = { autor: string; fecha: Date; contenido: string };
export type EventoRevisionDetalle = {
  tipo: "completada" | "aprobada" | "correccion_solicitada" | "reabierta" | "cancelada";
  fecha: Date; usuario: string; notas: string | null;
};

/** Una tarea o vencimiento con TODO su detalle — no solo qué se hizo, sino
 * quién es el responsable, el hilo completo de comentarios (cada uno con
 * su autor y fecha), y cada paso de revisión (aprobación o corrección)
 * con fecha, usuario, y el motivo cuando aplica. Se muestra completo aun
 * si parte de ese historial quedó fuera del periodo del informe, para que
 * el cliente tenga el contexto entero de la tarea. */
export type ActividadConDetalle = {
  tipo: "tarea" | "vencimiento";
  titulo: string;
  responsable: string;
  fechaCompletada: Date | null;
  notasCompletado: string | null;
  comentarios: ComentarioDetalle[];
  eventosRevision: EventoRevisionDetalle[];
  /** Fecha usada para ordenar este bloque dentro del informe — la más
   * reciente entre completado/comentarios/revisiones que cayó dentro del
   * periodo solicitado. */
  fechaOrden: Date;
};

/** Actividad sin hilo de comentarios — cargue de libro auxiliar o
 * generación de un reporte contable. */
export type ActividadSimple = {
  tipo: "carga_auxiliar" | "reporte_generado";
  titulo: string;
  detalle: string | null;
  usuario: string;
  fecha: Date;
};

export type ResultadoGestionCliente = {
  actividades: ActividadConDetalle[];
  otras: ActividadSimple[];
};

const NOMBRES_REPORTE: Record<string, string> = {
  ERM: "Estado de Resultados Mensual",
  ERI: "Estado de Resultados por Centro de Costo (ERI)",
  DIAN: "Comparación DIAN vs. contabilidad",
};

/** Recopila, para un cliente y un rango de fechas, cada tarea y
 * vencimiento tributario con actividad en el periodo (completado,
 * comentado, o con un paso de revisión) — junto con su historial COMPLETO
 * de comentarios y revisiones, para que el informe le dé al cliente el
 * contexto entero de cada una. También recopila, aparte, los cargues de
 * libro auxiliar y la generación de reportes contables del periodo.
 * Esto alimenta el informe de "Gestión Cliente" que se entrega al
 * cliente. */
export async function getActividadesGestionCliente(
  clienteId: number, fechaInicio: Date, fechaFin: Date,
): Promise<ResultadoGestionCliente> {
  const db = await getDb();
  if (!db) return { actividades: [], otras: [] };

  const nombreUsuario = new Map<number, string>();
  const resolverUsuario = async (id: number | null | undefined): Promise<string> => {
    if (id == null) return "Sistema";
    if (nombreUsuario.has(id)) return nombreUsuario.get(id)!;
    const fila = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
    const nombre = fila[0]?.name || "Usuario";
    nombreUsuario.set(id, nombre);
    return nombre;
  };
  const dentroDelPeriodo = (d: Date | null) => d != null && d >= fechaInicio && d <= fechaFin;

  const todasTareas = await db.select().from(tasks).where(eq(tasks.clientId, clienteId));
  const todosVencimientos = await db.select({
    id: taxDeadlines.id, period: taxDeadlines.period, completedAt: taxDeadlines.completedAt,
    completedById: taxDeadlines.completedById, notes: taxDeadlines.notes, obligationName: taxObligations.name,
  })
    .from(taxDeadlines).innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .where(eq(taxDeadlines.clientId, clienteId));

  const idsTareas = todasTareas.map(t => t.id);
  const idsVencimientos = todosVencimientos.map(v => v.id);

  const comentariosPorEntidad = new Map<string, { authorId: number; content: string; createdAt: Date }[]>();
  const eventosPorEntidad = new Map<string, { eventType: string; userId: number; notes: string | null; createdAt: Date }[]>();

  for (const [entityType, ids] of [["task", idsTareas], ["deadline", idsVencimientos]] as const) {
    if (ids.length === 0) continue;
    const filasComentarios = await db.select().from(comments)
      .where(and(eq(comments.entityType, entityType), inArray(comments.entityId, ids)))
      .orderBy(asc(comments.createdAt));
    for (const c of filasComentarios) {
      const clave = `${entityType}:${c.entityId}`;
      if (!comentariosPorEntidad.has(clave)) comentariosPorEntidad.set(clave, []);
      comentariosPorEntidad.get(clave)!.push(c);
    }
    const filasEventos = await db.select().from(historyEvents)
      .where(and(eq(historyEvents.entityType, entityType), inArray(historyEvents.entityId, ids)))
      .orderBy(asc(historyEvents.createdAt));
    for (const e of filasEventos) {
      if (e.eventType === "creada") continue; // ruido — no aporta al cliente
      const clave = `${entityType}:${e.entityId}`;
      if (!eventosPorEntidad.has(clave)) eventosPorEntidad.set(clave, []);
      eventosPorEntidad.get(clave)!.push(e);
    }
  }

  const actividades: ActividadConDetalle[] = [];

  for (const t of todasTareas) {
    const clave = `task:${t.id}`;
    const comentariosCrudos = comentariosPorEntidad.get(clave) || [];
    const eventosCrudos = eventosPorEntidad.get(clave) || [];
    const tocaPeriodo = dentroDelPeriodo(t.completedAt)
      || comentariosCrudos.some(c => dentroDelPeriodo(c.createdAt))
      || eventosCrudos.some(e => dentroDelPeriodo(e.createdAt));
    if (!tocaPeriodo) continue;

    const comentarios: ComentarioDetalle[] = [];
    for (const c of comentariosCrudos) comentarios.push({ autor: await resolverUsuario(c.authorId), fecha: c.createdAt, contenido: c.content });
    const eventosRevision: EventoRevisionDetalle[] = [];
    for (const e of eventosCrudos) {
      eventosRevision.push({ tipo: e.eventType as EventoRevisionDetalle["tipo"], fecha: e.createdAt, usuario: await resolverUsuario(e.userId), notas: e.notes });
    }

    const fechasEnPeriodo = [
      dentroDelPeriodo(t.completedAt) ? t.completedAt! : null,
      ...comentariosCrudos.filter(c => dentroDelPeriodo(c.createdAt)).map(c => c.createdAt),
      ...eventosCrudos.filter(e => dentroDelPeriodo(e.createdAt)).map(e => e.createdAt),
    ].filter((d): d is Date => d != null);

    actividades.push({
      tipo: "tarea", titulo: t.title, responsable: await resolverUsuario(t.completedById ?? t.assignedToId),
      fechaCompletada: t.completedAt, notasCompletado: t.completionNotes,
      comentarios, eventosRevision,
      fechaOrden: new Date(Math.max(...fechasEnPeriodo.map(d => d.getTime()))),
    });
  }

  for (const v of todosVencimientos) {
    const clave = `deadline:${v.id}`;
    const comentariosCrudos = comentariosPorEntidad.get(clave) || [];
    const eventosCrudos = eventosPorEntidad.get(clave) || [];
    const tocaPeriodo = dentroDelPeriodo(v.completedAt)
      || comentariosCrudos.some(c => dentroDelPeriodo(c.createdAt))
      || eventosCrudos.some(e => dentroDelPeriodo(e.createdAt));
    if (!tocaPeriodo) continue;

    const comentarios: ComentarioDetalle[] = [];
    for (const c of comentariosCrudos) comentarios.push({ autor: await resolverUsuario(c.authorId), fecha: c.createdAt, contenido: c.content });
    const eventosRevision: EventoRevisionDetalle[] = [];
    for (const e of eventosCrudos) {
      eventosRevision.push({ tipo: e.eventType as EventoRevisionDetalle["tipo"], fecha: e.createdAt, usuario: await resolverUsuario(e.userId), notas: e.notes });
    }

    const fechasEnPeriodo = [
      dentroDelPeriodo(v.completedAt) ? v.completedAt! : null,
      ...comentariosCrudos.filter(c => dentroDelPeriodo(c.createdAt)).map(c => c.createdAt),
      ...eventosCrudos.filter(e => dentroDelPeriodo(e.createdAt)).map(e => e.createdAt),
    ].filter((d): d is Date => d != null);

    actividades.push({
      tipo: "vencimiento", titulo: `${v.obligationName} — periodo ${v.period}`,
      responsable: await resolverUsuario(v.completedById),
      fechaCompletada: v.completedAt, notasCompletado: v.notes,
      comentarios, eventosRevision,
      fechaOrden: new Date(Math.max(...fechasEnPeriodo.map(d => d.getTime()))),
    });
  }

  actividades.sort((a, b) => a.fechaOrden.getTime() - b.fechaOrden.getTime());

  // ---- Cargues de libro auxiliar y generación de reportes (sin hilo de comentarios) ----
  const otras: ActividadSimple[] = [];
  const cargas = await db.select().from(informesCargas).where(and(
    eq(informesCargas.clienteId, clienteId), gte(informesCargas.createdAt, fechaInicio), lte(informesCargas.createdAt, fechaFin),
  ));
  for (const c of cargas) {
    if (c.estado !== "completado") continue;
    otras.push({
      tipo: "carga_auxiliar", titulo: "Cargue de libro auxiliar",
      detalle: `Archivo: ${c.nombreArchivo} (${c.mes}/${c.anio})`,
      usuario: await resolverUsuario(c.cargadoPorId), fecha: c.createdAt,
    });
  }
  const reportes = await db.select().from(informesReportes).where(and(
    eq(informesReportes.clienteId, clienteId), gte(informesReportes.createdAt, fechaInicio), lte(informesReportes.createdAt, fechaFin),
  ));
  for (const r of reportes) {
    const nombre = NOMBRES_REPORTE[r.tipo] || r.tipo;
    otras.push({
      tipo: "reporte_generado", titulo: `Generación de ${nombre}`,
      detalle: r.mes ? `Periodo: ${r.mes}/${r.anio}` : `Año: ${r.anio}`,
      usuario: await resolverUsuario(r.generadoPorId), fecha: r.createdAt,
    });
  }
  otras.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  return { actividades, otras };
}

const NOMBRES_EVENTO: Record<EventoRevisionDetalle["tipo"], string> = {
  completada: "Completada",
  aprobada: "Aprobada en revisión",
  correccion_solicitada: "Devuelta para corrección",
  reabierta: "Reabierta",
  cancelada: "Cancelada",
};

type BloqueImprimible =
  | { fecha: Date; clase: "detalle"; actividad: ActividadConDetalle }
  | { fecha: Date; clase: "simple"; actividad: ActividadSimple };

/** Genera el PDF de "Gestión Cliente" — un informe con destino al cliente
 * que resume, en orden cronológico, todo lo que se hizo por su cuenta
 * durante el periodo seleccionado. Cada tarea y vencimiento muestra su
 * detalle completo: responsable, el hilo entero de comentarios (cada uno
 * con su autor y fecha), y cada paso de revisión (aprobación o corrección,
 * con fecha, usuario, y motivo). Mismo estilo visual (logo al pie) que
 * los demás documentos que se entregan al cliente. */
export async function generarInformeGestionCliente(
  clienteNombre: string, clienteNit: string, fechaInicio: Date, fechaFin: Date,
  resultado: ResultadoGestionCliente,
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
  const saltarSiNoCabe = (altoNecesario: number) => {
    if (doc.y + altoNecesario > doc.page.height - doc.page.margins.bottom) {
      dibujarPiePaginaAreda(doc);
      doc.addPage();
    }
  };

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
    "gestión contable adelantada, con el responsable, los comentarios registrados, y el resultado de cada revisión.",
    { width: anchoUtil, align: "justify" },
  );
  doc.moveDown(1);

  const bloques: BloqueImprimible[] = [
    ...resultado.actividades.map((a): BloqueImprimible => ({ fecha: a.fechaOrden, clase: "detalle", actividad: a })),
    ...resultado.otras.map((a): BloqueImprimible => ({ fecha: a.fecha, clase: "simple", actividad: a })),
  ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  if (bloques.length === 0) {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor("#777777")
      .text("No se registraron actividades para este cliente durante el periodo seleccionado.");
    doc.fillColor("#000000");
    dibujarPiePaginaAreda(doc);
    doc.end();
    return done;
  }

  doc.font("Helvetica-Bold").fontSize(12).text("Actividades realizadas");
  doc.moveDown(0.4);

  for (const bloque of bloques) {
    if (bloque.clase === "simple") {
      const act = bloque.actividad;
      saltarSiNoCabe(45);
      const yInicio = doc.y;
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#42302E").text(fmtFechaHora(act.fecha), xLabel, yInicio, { width: 140 });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#8a6d00")
        .text(act.titulo, xLabel + 145, yInicio, { width: anchoUtil - 145 });
      doc.moveDown(0.15);
      if (act.detalle) doc.font("Helvetica-Oblique").fontSize(9).fillColor("#555555").text(act.detalle, xLabel + 10, doc.y, { width: anchoUtil - 10 });
      doc.font("Helvetica").fontSize(8.5).fillColor("#777777").text(`Responsable: ${act.usuario}`, xLabel + 10, doc.y + 2);
      doc.fillColor("#000000");
      doc.moveDown(0.6);
      doc.moveTo(xLabel, doc.y).lineTo(xLabel + anchoUtil, doc.y).strokeColor("#e5e5e5").stroke();
      doc.moveDown(0.5);
      continue;
    }

    const act = bloque.actividad;
    // Bloque de tarea/vencimiento con detalle completo — se estima la
    // altura de todo el bloque (título + responsable + cada comentario +
    // cada evento de revisión) para no partirlo a la mitad entre páginas.
    const anchoTexto = anchoUtil - 10;
    let altoEstimado = 55;
    if (act.notasCompletado) altoEstimado += doc.heightOfString(act.notasCompletado, { width: anchoTexto }) + 4;
    for (const c of act.comentarios) altoEstimado += doc.heightOfString(`${c.autor}: ${c.contenido}`, { width: anchoTexto }) + 14;
    for (const e of act.eventosRevision) altoEstimado += doc.heightOfString(e.notas || "", { width: anchoTexto }) + 26;
    saltarSiNoCabe(Math.min(altoEstimado, doc.page.height - doc.page.margins.top - doc.page.margins.bottom - 10));

    const yInicio = doc.y;
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#42302E").text(fmtFechaHora(bloque.fecha), xLabel, yInicio, { width: 140 });
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#8a6d00")
      .text(act.tipo === "tarea" ? "Tarea" : "Vencimiento tributario", xLabel + 145, yInicio, { width: anchoUtil - 145 });
    doc.moveDown(0.15);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000").text(act.titulo, xLabel, doc.y, { width: anchoUtil });
    doc.font("Helvetica").fontSize(8.5).fillColor("#777777").text(`Responsable: ${act.responsable}`, xLabel, doc.y + 1);
    doc.fillColor("#000000");

    if (act.fechaCompletada) {
      doc.font("Helvetica").fontSize(9).text(`Completada el ${fmtFechaHora(act.fechaCompletada)}`, xLabel + 10, doc.y + 3, { width: anchoTexto });
      if (act.notasCompletado && act.notasCompletado.trim()) {
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#555555")
          .text(`Nota: ${act.notasCompletado.trim()}`, xLabel + 10, doc.y + 1, { width: anchoTexto });
        doc.fillColor("#000000");
      }
    }

    if (act.comentarios.length > 0) {
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(9).text("Comentarios:", xLabel + 10, doc.y);
      for (const c of act.comentarios) {
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#42302E")
          .text(`${c.autor}`, xLabel + 18, doc.y + 2, { continued: true, width: anchoTexto - 8 })
          .font("Helvetica").fillColor("#777777")
          .text(` — ${fmtFechaHora(c.fecha)}`);
        doc.font("Helvetica").fontSize(8.5).fillColor("#000000").text(c.contenido, xLabel + 18, doc.y + 1, { width: anchoTexto - 8 });
      }
      doc.fillColor("#000000");
    }

    if (act.eventosRevision.length > 0) {
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(9).text("Revisión:", xLabel + 10, doc.y);
      for (const e of act.eventosRevision) {
        const etiqueta = NOMBRES_EVENTO[e.tipo] || e.tipo;
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(e.tipo === "correccion_solicitada" ? "#b45309" : "#166534")
          .text(etiqueta, xLabel + 18, doc.y + 2, { continued: true, width: anchoTexto - 8 })
          .font("Helvetica").fillColor("#777777")
          .text(` — ${fmtFechaHora(e.fecha)} por ${e.usuario}`);
        if (e.notas && e.notas.trim()) {
          const etiquetaMotivo = e.tipo === "correccion_solicitada" ? "Motivo" : "Nota";
          doc.font("Helvetica-Oblique").fontSize(8.5).fillColor("#555555")
            .text(`${etiquetaMotivo}: ${e.notas.trim()}`, xLabel + 18, doc.y + 1, { width: anchoTexto - 8 });
        }
      }
      doc.fillColor("#000000");
    }

    doc.moveDown(0.6);
    doc.moveTo(xLabel, doc.y).lineTo(xLabel + anchoUtil, doc.y).strokeColor("#e5e5e5").stroke();
    doc.moveDown(0.5);
  }

  dibujarPiePaginaAreda(doc);
  doc.end();
  return done;
}
