import { eq, and, desc, ne, isNull } from "drizzle-orm";
import { getDb } from "./db";
import {
  oficinaAgentes, InsertOficinaAgente,
  oficinaMensajes,
  oficinaSolicitudes,
  oficinaRevisiones,
  oficinaCorreos,
  tasks, users, clients,
} from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { bogotaTodayUTCMidnight } from "./dateUtils";

// ---------------------------------------------------------------------
// Agentes — perfil y estado
// ---------------------------------------------------------------------

/** Perfiles por defecto de los agentes de la Oficina. Activos: el
 * "Estadista de Tareas" y el "Agente de Correo" (ver oficinaCorreoDb.ts).
 * El de desarrollo sigue como escritorio "próximamente". */
const AGENTES_DEFAULT: InsertOficinaAgente[] = [
  {
    slug: "estadista_tareas",
    nombre: "Estadista de Tareas",
    tipo: "estadista_tareas",
    personalidad: "Directo, ordenado y sin rodeos — como un jefe de operaciones que resume solo lo que importa.",
    objetivo: "Llevar el control de cumplimiento de tareas y vencimientos de Areda Work: quién cumple, quién no, y qué se quedó represado o sin movimiento.",
    especialidad: "Estadísticas de cumplimiento por colaborador, tareas vencidas, tareas represadas en corrección/completar, y tareas olvidadas sin fecha límite.",
    criterioTerminado: "Cada revisión deja un resumen claro y, si hay algo que amerite la atención de Arlex, una solicitud puntual por cada hallazgo (nunca una genérica).",
    esfuerzo: "medium",
    activo: true,
  },
  {
    slug: "correo",
    nombre: "Agente de Correo",
    tipo: "correo",
    personalidad: "Atento y preciso — como un asistente de gerencia que lee todo el correo y solo interrumpe por lo que de verdad importa. Cordial y profesional al redactar.",
    objetivo: "Revisar los buzones de la firma, separar lo importante del ruido y dejar listo lo que se pueda adelantar: el resumen de cada correo, un borrador de respuesta y la tarea para el responsable.",
    especialidad: "Son urgentes los requerimientos y plazos de la DIAN, UGPP y demás entidades, y cualquier cliente que espere respuesta desde hace más de un día. La publicidad y los boletines no requieren atención.",
    criterioTerminado: "Cada correo que requiere atención queda con su resumen y la acción sugerida; nunca se envía nada sin que una persona lo revise.",
    esfuerzo: "medium",
    activo: true,
  },
  {
    slug: "desarrollo",
    nombre: "Monitor de Desarrollo",
    tipo: "desarrollo",
    esfuerzo: "medium",
    activo: false,
  },
];

/** Crea los agentes por defecto si todavía no existen (idempotente — no
 * pisa nombre/personalidad si Arlex ya los personalizó). Se llama al
 * listar, así no hace falta una migración de datos aparte. */
export async function asegurarAgentesPorDefecto(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  for (const agente of AGENTES_DEFAULT) {
    const existente = await db.select({ id: oficinaAgentes.id }).from(oficinaAgentes)
      .where(eq(oficinaAgentes.slug, agente.slug)).limit(1);
    if (existente.length === 0) {
      await db.insert(oficinaAgentes).values(agente);
    }
  }
  // El Agente de Correo ya existía como fila "próximamente" (inactivo y sin
  // perfil) desde la primera entrega de la Oficina: se activa y se le da su
  // perfil por defecto UNA sola vez — si Arlex ya lo personalizó (tiene
  // objetivo) o ya está activo, no se toca.
  const correoDefault = AGENTES_DEFAULT.find(a => a.slug === "correo")!;
  await db.update(oficinaAgentes).set({
    activo: true,
    personalidad: correoDefault.personalidad, objetivo: correoDefault.objetivo,
    especialidad: correoDefault.especialidad, criterioTerminado: correoDefault.criterioTerminado,
  }).where(and(eq(oficinaAgentes.slug, "correo"), eq(oficinaAgentes.activo, false), isNull(oficinaAgentes.objetivo)));
}

export async function listarAgentes() {
  const db = await getDb();
  if (!db) return [];
  await asegurarAgentesPorDefecto();
  const filas = await db.select().from(oficinaAgentes).orderBy(oficinaAgentes.id);
  // Conteo de solicitudes pendientes por agente, para la mano levantada.
  const pendientes = await db.select({ agenteId: oficinaSolicitudes.agenteId })
    .from(oficinaSolicitudes).where(eq(oficinaSolicitudes.estado, "pendiente"));
  const conteoPorAgente = new Map<number, number>();
  for (const p of pendientes) conteoPorAgente.set(p.agenteId, (conteoPorAgente.get(p.agenteId) || 0) + 1);
  return filas.map(a => ({ ...a, solicitudesPendientes: conteoPorAgente.get(a.id) || 0 }));
}

export async function getAgenteById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const filas = await db.select().from(oficinaAgentes).where(eq(oficinaAgentes.id, id)).limit(1);
  return filas[0] || null;
}

export async function actualizarAgente(id: number, data: {
  nombre?: string; personalidad?: string; objetivo?: string; especialidad?: string;
  criterioTerminado?: string; esfuerzo?: "low" | "medium" | "high";
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(oficinaAgentes).set(data).where(eq(oficinaAgentes.id, id));
}

export async function marcarEstado(agenteId: number, estado: "libre" | "trabajando" | "esperando" | "error", errorMsg?: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(oficinaAgentes).set({
    estado,
    ultimoErrorMensaje: estado === "error" ? (errorMsg || "Error desconocido") : null,
  }).where(eq(oficinaAgentes.id, agenteId));
}

/** Recalcula libre/esperando según si el agente tiene solicitudes
 * pendientes — se llama después de crear o resolver solicitudes. No pisa
 * el estado "error" (ese solo lo limpia una revisión exitosa). */
export async function recalcularEstadoPorSolicitudes(agenteId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const agente = await getAgenteById(agenteId);
  if (!agente || agente.estado === "error") return;
  const pendientes = await db.select({ id: oficinaSolicitudes.id }).from(oficinaSolicitudes)
    .where(and(eq(oficinaSolicitudes.agenteId, agenteId), eq(oficinaSolicitudes.estado, "pendiente")));
  await db.update(oficinaAgentes).set({ estado: pendientes.length > 0 ? "esperando" : "libre" }).where(eq(oficinaAgentes.id, agenteId));
}

// ---------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------

export async function listarMensajes(agenteId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(oficinaMensajes).where(eq(oficinaMensajes.agenteId, agenteId)).orderBy(oficinaMensajes.id);
}

const MAX_HISTORIAL_CHAT = 20;

/** Construye el system prompt del agente a partir de su perfil — el mismo
 * patrón DOE del kit Pulpo Starter, simplificado: identidad + alcance. */
function construirSystemPrompt(agente: { nombre: string; personalidad: string | null; objetivo: string | null; especialidad: string | null; criterioTerminado: string | null }, contexto?: string): string {
  return [
    `Eres "${agente.nombre}", un agente interno de la Oficina IA de Areda SAS (firma contable colombiana), hablando directamente con Arlex, el administrador de la firma.`,
    agente.personalidad ? `Personalidad: ${agente.personalidad}` : "",
    agente.objetivo ? `Objetivo: ${agente.objetivo}` : "",
    agente.especialidad ? `Especialidad: ${agente.especialidad}` : "",
    agente.criterioTerminado ? `Consideras un encargo terminado cuando: ${agente.criterioTerminado}` : "",
    "Responde siempre en español, de forma breve y concreta. No inventes cifras — si no tienes el dato, dilo.",
    contexto ? `\nDatos actuales disponibles para responder:\n${contexto}` : "",
  ].filter(Boolean).join("\n");
}

export const ESFUERZO_A_MAX_TOKENS: Record<string, number> = { low: 500, medium: 1200, high: 2200 };

export async function enviarMensajeChat(agenteId: number, mensajeUsuario: string): Promise<{ respuesta: string }> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const agente = await getAgenteById(agenteId);
  if (!agente) throw new Error("Agente no encontrado");

  await db.insert(oficinaMensajes).values({ agenteId, rol: "user", contenido: mensajeUsuario });

  const historial = await db.select().from(oficinaMensajes).where(eq(oficinaMensajes.agenteId, agenteId))
    .orderBy(desc(oficinaMensajes.id)).limit(MAX_HISTORIAL_CHAT);
  historial.reverse();

  // Contexto vivo solo para el Estadista de Tareas — le da algo real
  // sobre qué responder en vez de una conversación en el vacío.
  let contexto: string | undefined;
  if (agente.tipo === "estadista_tareas") {
    const solicitudesPendientes = await db.select().from(oficinaSolicitudes)
      .where(and(eq(oficinaSolicitudes.agenteId, agenteId), eq(oficinaSolicitudes.estado, "pendiente")));
    contexto = solicitudesPendientes.length > 0
      ? solicitudesPendientes.map(s => `- [${s.severidad}] ${s.titulo}: ${s.detalle || ""}`).join("\n")
      : "No hay hallazgos pendientes en este momento — la última revisión no encontró nada que requiera tu atención.";
  } else if (agente.tipo === "correo") {
    // Import dinámico: oficinaCorreoDb ya importa este módulo.
    const { contextoChatCorreo } = await import("./oficinaCorreoDb");
    contexto = await contextoChatCorreo();
  }

  try {
    const respuesta = await invokeLLM({
      messages: [
        { role: "system", content: construirSystemPrompt(agente, contexto) },
        ...historial.map(m => ({ role: m.rol, content: m.contenido })),
      ],
      max_tokens: ESFUERZO_A_MAX_TOKENS[agente.esfuerzo] ?? 1200,
    });
    const texto = respuesta.choices[0]?.message?.content?.trim() || "No pude generar una respuesta.";
    await db.insert(oficinaMensajes).values({ agenteId, rol: "assistant", contenido: texto });
    return { respuesta: texto };
  } catch (error: any) {
    const mensaje = error?.message || "No se pudo completar la conversación.";
    await db.insert(oficinaMensajes).values({ agenteId, rol: "assistant", contenido: `⚠️ ${mensaje}` });
    throw new Error(mensaje);
  }
}

// ---------------------------------------------------------------------
// Solicitudes
// ---------------------------------------------------------------------

/** `tipo` de las solicitudes que levanta el Agente de Correo; su `refId`
 * es el id del correo en oficinaCorreos. */
export const TIPO_SOLICITUD_CORREO = "correo";

export async function listarSolicitudes(agenteId?: number) {
  const db = await getDb();
  if (!db) return [];
  const query = db.select().from(oficinaSolicitudes);
  const filas = agenteId
    ? await query.where(eq(oficinaSolicitudes.agenteId, agenteId)).orderBy(desc(oficinaSolicitudes.createdAt))
    : await query.orderBy(desc(oficinaSolicitudes.createdAt));
  return filas;
}

export async function resolverSolicitud(id: number, accion: "atender" | "descartar"): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const filas = await db.select().from(oficinaSolicitudes).where(eq(oficinaSolicitudes.id, id)).limit(1);
  const solicitud = filas[0];
  if (!solicitud) throw new Error("Solicitud no encontrada");
  await db.update(oficinaSolicitudes).set({
    estado: accion === "atender" ? "atendida" : "descartada",
    resueltaAt: new Date(),
  }).where(eq(oficinaSolicitudes.id, id));
  // Las solicitudes del Agente de Correo apuntan a un correo de su
  // bandeja: resolverlas aquí también lo saca de "requieren atención" allá.
  if (solicitud.tipo === TIPO_SOLICITUD_CORREO && solicitud.refId != null) {
    await db.update(oficinaCorreos).set({ estado: accion === "atender" ? "gestionado" : "descartado" })
      .where(eq(oficinaCorreos.id, solicitud.refId));
  }
  await recalcularEstadoPorSolicitudes(solicitud.agenteId);
}

/** Crea la solicitud solo si no existe ya una pendiente con el mismo
 * tipo+refId — evita duplicar el mismo hallazgo en cada revisión. */
export async function crearSolicitudSiNueva(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, agenteId: number, tipo: string, refId: number | null, titulo: string, detalle: string, severidad: "info" | "atencion" | "urgente"): Promise<boolean> {
  const existente = await db.select({ id: oficinaSolicitudes.id }).from(oficinaSolicitudes)
    .where(and(
      eq(oficinaSolicitudes.agenteId, agenteId),
      eq(oficinaSolicitudes.tipo, tipo),
      refId != null ? eq(oficinaSolicitudes.refId, refId) : isNull(oficinaSolicitudes.refId),
      eq(oficinaSolicitudes.estado, "pendiente"),
    )).limit(1);
  if (existente.length > 0) return false;
  await db.insert(oficinaSolicitudes).values({ agenteId, tipo, refId, titulo, detalle, severidad });
  return true;
}

// ---------------------------------------------------------------------
// Estadista de Tareas — análisis
// ---------------------------------------------------------------------

const DIAS_REPRESADA = 5; // sin movimiento en corrección/completar
const DIAS_OLVIDADA = 10; // pendiente/en_progreso sin fecha límite, sin movimiento

export type HallazgoEstadista = {
  tipo: string; refId: number | null; titulo: string; detalle: string; severidad: "info" | "atencion" | "urgente";
};

/** El análisis en sí — 100% determinístico sobre datos reales de la BD,
 * sin IA (capa 3 del DOE). La IA solo se usa después para redactar el
 * resumen en lenguaje natural (capa de comunicación), nunca para decidir
 * los hechos. */
async function calcularHallazgos(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<{ hallazgos: HallazgoEstadista[]; metricas: Record<string, unknown> }> {
  const hoy = bogotaTodayUTCMidnight();
  const limiteRepresada = new Date(hoy.getTime() - DIAS_REPRESADA * 24 * 60 * 60 * 1000);
  const limiteOlvidada = new Date(hoy.getTime() - DIAS_OLVIDADA * 24 * 60 * 60 * 1000);

  const filas = await db.select({
    id: tasks.id, title: tasks.title, assignedToId: tasks.assignedToId, assignedToName: users.name,
    clientName: clients.razonSocial, dueDate: tasks.dueDate, status: tasks.status,
    reviewStatus: tasks.reviewStatus, createdAt: tasks.createdAt, updatedAt: tasks.updatedAt,
    completedAt: tasks.completedAt,
  }).from(tasks)
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(ne(tasks.status, "cancelada"));

  const hallazgos: HallazgoEstadista[] = [];

  // 1) Vencidas: no completadas y con fecha límite ya pasada.
  const vencidas = filas.filter(t => t.status !== "completada" && t.dueDate && new Date(t.dueDate) < hoy);
  for (const t of vencidas) {
    hallazgos.push({
      tipo: "tarea_vencida", refId: t.id,
      titulo: `Vencida: ${t.title}${t.clientName ? ` (${t.clientName})` : ""}`,
      detalle: `Responsable: ${t.assignedToName || "sin asignar"}. Venció el ${new Date(t.dueDate!).toLocaleDateString("es-CO")}.`,
      severidad: "urgente",
    });
  }

  // 2) Represadas: devueltas para corrección/completar y sin movimiento
  //    desde hace DIAS_REPRESADA días — quedaron "colgadas" sin que nadie
  //    responda a la observación.
  const represadas = filas.filter(t =>
    t.status !== "completada" && (t.reviewStatus === "correccion" || t.reviewStatus === "completar") &&
    new Date(t.updatedAt) < limiteRepresada
  );
  for (const t of represadas) {
    const dias = Math.floor((hoy.getTime() - new Date(t.updatedAt).getTime()) / (24 * 60 * 60 * 1000));
    hallazgos.push({
      tipo: "tarea_represada", refId: t.id,
      titulo: `Represada: ${t.title}${t.clientName ? ` (${t.clientName})` : ""}`,
      detalle: `Responsable: ${t.assignedToName || "sin asignar"}. Lleva ${dias} días en "${t.reviewStatus === "correccion" ? "corrección" : "completar"}" sin movimiento.`,
      severidad: "atencion",
    });
  }

  // 3) Olvidadas: sin fecha límite, activas desde hace mucho, sin tocarse.
  const olvidadas = filas.filter(t =>
    !t.dueDate && (t.status === "pendiente" || t.status === "en_progreso") &&
    new Date(t.updatedAt) < limiteOlvidada
  );
  for (const t of olvidadas) {
    const dias = Math.floor((hoy.getTime() - new Date(t.updatedAt).getTime()) / (24 * 60 * 60 * 1000));
    hallazgos.push({
      tipo: "tarea_olvidada", refId: t.id,
      titulo: `Olvidada: ${t.title}${t.clientName ? ` (${t.clientName})` : ""}`,
      detalle: `Responsable: ${t.assignedToName || "sin asignar"}. Sin fecha límite y sin movimiento hace ${dias} días.`,
      severidad: "info",
    });
  }

  // 4) Cumplimiento por colaborador (últimas tareas con fecha límite y ya
  //    resueltas de alguna forma) — % a tiempo, no genera solicitud propia,
  //    solo alimenta el resumen y el chat.
  const cumplimientoPorColaborador = new Map<string, { aTiempo: number; tarde: number }>();
  for (const t of filas) {
    if (!t.assignedToName || !t.dueDate || !t.completedAt) continue;
    const key = t.assignedToName;
    const stats = cumplimientoPorColaborador.get(key) || { aTiempo: 0, tarde: 0 };
    if (new Date(t.completedAt) <= new Date(t.dueDate)) stats.aTiempo++; else stats.tarde++;
    cumplimientoPorColaborador.set(key, stats);
  }
  const cumplimiento = Array.from(cumplimientoPorColaborador.entries()).map(([nombre, s]) => ({
    nombre, aTiempo: s.aTiempo, tarde: s.tarde,
    porcentajeATiempo: s.aTiempo + s.tarde > 0 ? Math.round((s.aTiempo / (s.aTiempo + s.tarde)) * 100) : null,
  }));

  return {
    hallazgos,
    metricas: {
      totalActivas: filas.filter(t => t.status !== "completada").length,
      vencidas: vencidas.length, represadas: represadas.length, olvidadas: olvidadas.length,
      cumplimientoPorColaborador: cumplimiento,
    },
  };
}

export async function revisarAhoraEstadista(): Promise<{ resumen: string; solicitudesCreadas: number }> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  await asegurarAgentesPorDefecto();
  const agenteFilas = await db.select().from(oficinaAgentes).where(eq(oficinaAgentes.slug, "estadista_tareas")).limit(1);
  const agente = agenteFilas[0];
  if (!agente) throw new Error("Agente Estadista de Tareas no encontrado");

  await marcarEstado(agente.id, "trabajando");

  try {
    const { hallazgos, metricas } = await calcularHallazgos(db);

    let solicitudesCreadas = 0;
    for (const h of hallazgos) {
      const creada = await crearSolicitudSiNueva(db, agente.id, h.tipo, h.refId, h.titulo, h.detalle, h.severidad);
      if (creada) solicitudesCreadas++;
    }

    const resumen = await redactarResumen(agente, metricas, hallazgos.length, solicitudesCreadas);

    await db.insert(oficinaRevisiones).values({
      agenteId: agente.id, finalizadaAt: new Date(), estado: "ok",
      resumen, solicitudesCreadas,
    });
    await db.update(oficinaAgentes).set({ ultimaRevisionAt: new Date(), ultimoErrorMensaje: null }).where(eq(oficinaAgentes.id, agente.id));
    await recalcularEstadoPorSolicitudes(agente.id);

    return { resumen, solicitudesCreadas };
  } catch (error: any) {
    const mensaje = error?.message || "Error desconocido durante la revisión.";
    await db.insert(oficinaRevisiones).values({
      agenteId: agente.id, finalizadaAt: new Date(), estado: "error", error: mensaje,
    });
    await marcarEstado(agente.id, "error", mensaje);
    throw new Error(mensaje);
  }
}

async function redactarResumen(agente: { nombre: string; personalidad: string | null; esfuerzo: string }, metricas: Record<string, unknown>, totalHallazgos: number, nuevos: number): Promise<string> {
  if (totalHallazgos === 0) {
    return "Revisé las tareas y vencimientos activos y no encontré nada represado, vencido sin gestión ni olvidado en este momento. Todo al día.";
  }
  try {
    const respuesta = await invokeLLM({
      messages: [
        { role: "system", content: construirSystemPrompt(agente as any) + "\nRedacta un resumen ejecutivo de máximo 4-5 líneas en español, directo, sin adornos, basado ÚNICAMENTE en las métricas que te paso — no inventes nombres ni cifras que no estén ahí." },
        { role: "user", content: `Métricas de esta revisión (JSON):\n${JSON.stringify(metricas)}\n\nHallazgos totales: ${totalHallazgos}. Nuevos (no vistos antes): ${nuevos}.` },
      ],
      max_tokens: 400,
    });
    return respuesta.choices[0]?.message?.content?.trim() || `Encontré ${totalHallazgos} hallazgo(s), ${nuevos} nuevos.`;
  } catch {
    // Si la IA falla, el resumen determinístico igual es útil — no bloquea la revisión.
    return `Encontré ${totalHallazgos} hallazgo(s) (${nuevos} nuevos): ${metricas.vencidas} vencida(s), ${metricas.represadas} represada(s), ${metricas.olvidadas} olvidada(s).`;
  }
}

export async function ultimaRevision(agenteId: number) {
  const db = await getDb();
  if (!db) return null;
  const filas = await db.select().from(oficinaRevisiones).where(eq(oficinaRevisiones.agenteId, agenteId))
    .orderBy(desc(oficinaRevisiones.id)).limit(1);
  return filas[0] || null;
}
