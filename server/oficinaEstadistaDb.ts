import { and, eq, gte, inArray, lt, ne, or } from "drizzle-orm";
import { getDb, inferirRemitentes } from "./db";
import {
  users, tasks, taxDeadlines, taxObligations, clients, timeEntries, historyEvents, comments, oficinaActividad, notifications,
} from "../drizzle/schema";
import { calcularJornada } from "../shared/jornada";

/** Informe del equipo del Estadista de Tareas (Oficina):
 *   - cuántas tareas por terminar, devueltas y por completar tiene cada uno,
 *   - horas trabajadas del día anterior, la semana y el mes,
 *   - ranking de eficiencia,
 *   - y la actividad del día (quién entregó, comentó o leyó qué), que
 *     además se anuncia en voz alta a medida que ocurre.
 *
 * Todo es determinístico sobre los datos reales de la BD — aquí no hay IA.
 * Las mismas cifras alimentan la pantalla, el informe hablado y el chat. */

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

const DIA_MS = 24 * 60 * 60 * 1000;
/** Bogotá es UTC-5 todo el año (mismo criterio que dateUtils.ts). */
const BOGOTA_MS = 5 * 60 * 60 * 1000;
export const DIAS_RANKING = 30;
/** Con menos entregas que estas en el período, no hay base para puntuar. */
export const MIN_ENTREGAS_RANKING = 3;

// ---------------------------------------------------------------------
// Fechas (día calendario de Bogotá)
// ---------------------------------------------------------------------

/** "AAAA-MM-DD" del día de Bogotá en que cae un instante. */
export function diaBogota(instante: Date): string {
  return new Date(instante.getTime() - BOGOTA_MS).toISOString().slice(0, 10);
}

/** Instante en que EMPIEZA ese día en Bogotá (las 00:00 de allá). */
export function inicioDiaBogota(clave: string): Date {
  return new Date(new Date(`${clave}T00:00:00Z`).getTime() + BOGOTA_MS);
}

function sumarDias(clave: string, dias: number): string {
  return new Date(new Date(`${clave}T00:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Lunes de la semana de ese día. */
export function lunesDeLaSemana(clave: string): string {
  const diaSemana = new Date(`${clave}T00:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(clave, diaSemana === 0 ? -6 : 1 - diaSemana);
}

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "viernes 2 de octubre" */
export function fechaLarga(clave: string): string {
  const d = new Date(`${clave}T00:00:00Z`);
  return `${DIAS_SEMANA[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** Una entrega está a tiempo si se hizo antes de que TERMINE el día de la
 * fecha límite en Bogotá. `dueDate` se guarda como medianoche UTC del día
 * calendario, así que comparar los dos instantes directamente daría por
 * tardía cualquier entrega hecha el mismo día del vencimiento. */
export function entregadaATiempo(completedAt: Date | string, dueDate: Date | string): boolean {
  return new Date(completedAt).getTime() < new Date(dueDate).getTime() + DIA_MS + BOGOTA_MS;
}

// ---------------------------------------------------------------------
// Nombres
// ---------------------------------------------------------------------

const capitalizar = (palabra: string) => palabra ? palabra[0].toLocaleUpperCase("es") + palabra.slice(1).toLocaleLowerCase("es") : palabra;

/** Cómo llamar a cada persona en voz alta: su primer nombre; si dos
 * comparten el primer nombre, se le suma la segunda palabra (y si aun así
 * coinciden, el nombre completo). */
export function nombresCortos(lista: { id: number; name: string | null }[]): Map<number, string> {
  const partes = new Map(lista.map(u => [u.id, (u.name || "").trim().split(/\s+/).filter(Boolean).map(capitalizar)]));
  const cuenta = (n: number) => {
    const veces = new Map<string, number>();
    partes.forEach((p) => { const clave = p.slice(0, n).join(" "); veces.set(clave, (veces.get(clave) || 0) + 1); });
    return veces;
  };
  const conUno = cuenta(1), conDos = cuenta(2);
  const resultado = new Map<number, string>();
  partes.forEach((p, id) => {
    if (p.length === 0) { resultado.set(id, "Alguien"); return; }
    if (conUno.get(p[0]) === 1 || p.length === 1) resultado.set(id, p[0]);
    else if (conDos.get(p.slice(0, 2).join(" ")) === 1) resultado.set(id, p.slice(0, 2).join(" "));
    else resultado.set(id, p.join(" "));
  });
  return resultado;
}

// ---------------------------------------------------------------------
// Texto para voz
// ---------------------------------------------------------------------

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** "7 horas y 30 minutos", "1 hora", "45 minutos"; "sin registro" si es 0. */
export function duracionHablada(ms: number): string {
  const minutosTotales = Math.round(ms / 60000);
  if (minutosTotales <= 0) return "sin registro";
  const horas = Math.floor(minutosTotales / 60), minutos = minutosTotales % 60;
  const partes = [horas > 0 ? plural(horas, "hora", "horas") : "", minutos > 0 ? plural(minutos, "minuto", "minutos") : ""].filter(Boolean);
  return partes.join(" y ");
}

/** "a", "a y b", "a, b y c" */
export function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes[0] || "";
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

const ORDINALES = ["Primer lugar", "Segundo lugar", "Tercer lugar", "Cuarto lugar", "Quinto lugar", "Sexto lugar", "Séptimo lugar", "Octavo lugar", "Noveno lugar", "Décimo lugar"];

// ---------------------------------------------------------------------
// Puntaje de eficiencia
// ---------------------------------------------------------------------

export type DatosEficiencia = {
  /** Veces que entregó (subió para revisión) una tarea o vencimiento en el período. */
  entregas: number;
  /** Veces que le devolvieron una entrega para corrección en el período. */
  devoluciones: number;
  /** Entregas del período que tenían fecha límite, y cuántas de esas fueron a tiempo. */
  entregasConFecha: number;
  aTiempo: number;
  /** Lo que tiene hoy sin terminar y cuántas de esas ya están vencidas. */
  porTerminar: number;
  vencidas: number;
};

export type Puntaje = {
  /** 0–100, o null si no hay base para puntuar. */
  puntaje: number | null;
  /** Componentes en 0–1 (null = sin dato). */
  puntualidad: number | null;
  calidad: number | null;
  alDia: number;
};

/** Puntaje de eficiencia (0–100) = 50 % entregas a tiempo + 30 % entregas
 * sin devolución + 20 % estar al día (sin tareas vencidas). Si la persona
 * no tuvo entregas con fecha límite, la puntualidad no se puede medir y su
 * peso se reparte entre los otros dos. Con menos de MIN_ENTREGAS_RANKING
 * entregas no se puntúa: no hay base. */
export function calcularPuntaje(d: DatosEficiencia): Puntaje {
  const puntualidad = d.entregasConFecha > 0 ? d.aTiempo / d.entregasConFecha : null;
  const calidad = d.entregas > 0 ? Math.max(0, 1 - d.devoluciones / d.entregas) : null;
  const alDia = d.porTerminar > 0 ? Math.max(0, 1 - d.vencidas / d.porTerminar) : 1;
  if (d.entregas < MIN_ENTREGAS_RANKING || calidad == null) return { puntaje: null, puntualidad, calidad, alDia };
  const puntaje = puntualidad != null
    ? 0.5 * puntualidad + 0.3 * calidad + 0.2 * alDia
    : 0.6 * calidad + 0.4 * alDia;
  return { puntaje: Math.round(puntaje * 100), puntualidad, calidad, alDia };
}

// ---------------------------------------------------------------------
// Horas trabajadas
// ---------------------------------------------------------------------

export type HorasPersona = { diaAnteriorMs: number; semanaMs: number; mesMs: number; diasIncompletos: number };

/** Suma las horas por persona en los tres períodos, a partir de las marcas
 * de jornada del mes. Cada día se calcula con la misma regla de la
 * pantalla de Asistencia (shared/jornada.ts). El día de hoy no cuenta como
 * "incompleto" aunque tenga un bloque abierto: sigue en curso. */
export function resumirHoras(
  marcas: { userId: number; type: string; timestamp: Date | string }[],
  periodos: { hoy: string; diaAnterior: string; lunes: string; primeroDeMes: string },
): Map<number, HorasPersona> {
  const porPersonaYDia = new Map<number, Map<string, { type: string; timestamp: Date | string }[]>>();
  for (const m of marcas) {
    const dia = diaBogota(new Date(m.timestamp));
    if (!porPersonaYDia.has(m.userId)) porPersonaYDia.set(m.userId, new Map());
    const dias = porPersonaYDia.get(m.userId)!;
    if (!dias.has(dia)) dias.set(dia, []);
    dias.get(dia)!.push(m);
  }
  const resultado = new Map<number, HorasPersona>();
  porPersonaYDia.forEach((dias, userId) => {
    const horas: HorasPersona = { diaAnteriorMs: 0, semanaMs: 0, mesMs: 0, diasIncompletos: 0 };
    dias.forEach((marcasDelDia, dia) => {
      const jornada = calcularJornada(marcasDelDia);
      if (dia === periodos.diaAnterior) horas.diaAnteriorMs += jornada.ms;
      if (dia >= periodos.lunes && dia <= periodos.hoy) horas.semanaMs += jornada.ms;
      if (dia >= periodos.primeroDeMes && dia <= periodos.hoy) {
        horas.mesMs += jornada.ms;
        if (!jornada.completa && dia !== periodos.hoy) horas.diasIncompletos++;
      }
    });
    resultado.set(userId, horas);
  });
  return resultado;
}

// ---------------------------------------------------------------------
// Actividad (quién hizo qué) — para los avisos de voz y el resumen del día
// ---------------------------------------------------------------------

export type EventoActividad = {
  /** Identificador estable ("h-12", "c-5", "l-7") para no anunciar dos veces lo mismo. */
  clave: string;
  tipo: "entrega" | "comentario" | "lectura" | "lecturas_marcadas";
  cuando: Date;
  usuarioId: number;
  nombre: string;
  nombreCorto: string;
  /** Para pantalla. */
  texto: string;
  /** Para leer en voz alta (sin comillas ni símbolos). */
  voz: string;
};

type Entidad = { tipo: "task" | "deadline" | "board_post"; id: number };

async function cargarNombresEntidades(db: Db, entidades: Entidad[]) {
  const idsTareas = Array.from(new Set(entidades.filter(e => e.tipo === "task").map(e => e.id)));
  const idsVencimientos = Array.from(new Set(entidades.filter(e => e.tipo === "deadline").map(e => e.id)));
  const [filasTareas, filasVencimientos] = await Promise.all([
    idsTareas.length > 0
      ? db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, idsTareas))
      : Promise.resolve([] as { id: number; title: string }[]),
    idsVencimientos.length > 0
      ? db.select({ id: taxDeadlines.id, obligacion: taxObligations.name, cliente: clients.razonSocial })
        .from(taxDeadlines)
        .leftJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
        .leftJoin(clients, eq(taxDeadlines.clientId, clients.id))
        .where(inArray(taxDeadlines.id, idsVencimientos))
      : Promise.resolve([] as { id: number; obligacion: string | null; cliente: string | null }[]),
  ]);
  const tareas = new Map(filasTareas.map(t => [t.id, t.title]));
  const vencimientos = new Map(filasVencimientos.map(v => [v.id, [v.obligacion, v.cliente].filter(Boolean).join(" de ") || `número ${v.id}`]));
  /** { pantalla: "la tarea «X»", voz: "la tarea X" } con el artículo que pide `forma`. */
  return (e: Entidad | null, forma: "la" | "de la" | "en la") => {
    if (!e) return { pantalla: "", voz: "" };
    if (e.tipo === "task") {
      const titulo = tareas.get(e.id) || `número ${e.id}`;
      return { pantalla: `${forma} tarea «${titulo}»`, voz: `${forma} tarea ${titulo}` };
    }
    if (e.tipo === "deadline") {
      const articulo = forma === "la" ? "el" : forma === "de la" ? "del" : "en el";
      const nombre = vencimientos.get(e.id) || `número ${e.id}`;
      return { pantalla: `${articulo} vencimiento «${nombre}»`, voz: `${articulo} vencimiento ${nombre}` };
    }
    const articulo = forma === "la" ? "la" : forma === "de la" ? "de la" : "en la";
    return { pantalla: `${articulo} publicación del tablero`, voz: `${articulo} publicación del tablero` };
  };
}

const recortar = (texto: string, max: number) => {
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > max ? limpio.slice(0, max).trimEnd() + "…" : limpio;
};

/** Lo que hizo el equipo desde `desde`: entregas para revisión, comentarios
 * y lecturas, en orden cronológico. `excluirUsuarioId` es quien escucha
 * (Arlex): se dejan por fuera sus propias acciones, las respuestas a algo
 * que él escribió se anuncian como "te respondió", y de las lecturas solo
 * cuentan las de mensajes que él envió. */
export async function listarActividad(opciones: { desde: Date; excluirUsuarioId?: number; limite?: number }): Promise<EventoActividad[]> {
  const db = await getDb();
  if (!db) return [];
  const { desde } = opciones;
  const yo = opciones.excluirUsuarioId ?? null;

  const [entregas, comentarios, lecturas, todosLosUsuarios] = await Promise.all([
    db.select().from(historyEvents).where(and(eq(historyEvents.eventType, "completada"), gte(historyEvents.createdAt, desde))),
    db.select().from(comments).where(and(inArray(comments.entityType, ["task", "deadline"]), gte(comments.createdAt, desde))),
    // Si la migración de esta tabla aún no se ha corrido, el informe sigue
    // funcionando sin esa parte en vez de fallar entero.
    db.select().from(oficinaActividad).where(gte(oficinaActividad.createdAt, desde)).catch((error: any) => {
      console.error("[Oficina] No se pudieron leer las lecturas (¿falta la migración?):", String(error?.message || error).slice(0, 160));
      return [] as (typeof oficinaActividad.$inferSelect)[];
    }),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);

  const cortos = nombresCortos(todosLosUsuarios);
  const completos = new Map(todosLosUsuarios.map(u => [u.id, u.name || "Alguien"]));
  const esEntidad = (tipo: string | null): tipo is Entidad["tipo"] => tipo === "task" || tipo === "deadline" || tipo === "board_post";
  const nombrar = await cargarNombresEntidades(db, [
    ...entregas.map(e => ({ tipo: e.entityType, id: e.entityId })),
    ...comentarios.map(c => ({ tipo: c.entityType as "task" | "deadline", id: c.entityId })),
    ...lecturas.filter(l => esEntidad(l.entityType) && l.entityId != null).map(l => ({ tipo: l.entityType as Entidad["tipo"], id: l.entityId! })),
  ]);

  // ¿En qué tareas y vencimientos ya había escrito quien escucha (un
  // comentario o una observación de revisión)? Un comentario posterior de
  // otra persona ahí es una respuesta para él.
  const primerMensajeMio = new Map<string, number>();
  const comentariosAjenos = yo == null ? [] : comentarios.filter(c => c.authorId !== yo);
  if (yo != null && comentariosAjenos.length > 0) {
    const anotar = (tipo: string, id: number, cuando: Date) => {
      const clave = `${tipo}-${id}`;
      const t = new Date(cuando).getTime();
      if (!primerMensajeMio.has(clave) || t < primerMensajeMio.get(clave)!) primerMensajeMio.set(clave, t);
    };
    for (const tipo of ["task", "deadline"] as const) {
      const ids = Array.from(new Set(comentariosAjenos.filter(c => c.entityType === tipo).map(c => c.entityId)));
      if (ids.length === 0) continue;
      const [mios, misRevisiones] = await Promise.all([
        db.select({ entityId: comments.entityId, createdAt: comments.createdAt }).from(comments)
          .where(and(eq(comments.entityType, tipo), inArray(comments.entityId, ids), eq(comments.authorId, yo))),
        db.select({ entityId: historyEvents.entityId, createdAt: historyEvents.createdAt }).from(historyEvents)
          .where(and(eq(historyEvents.entityType, tipo), inArray(historyEvents.entityId, ids), eq(historyEvents.userId, yo),
            inArray(historyEvents.eventType, ["correccion_solicitada", "completar_solicitado", "aprobada"]))),
      ]);
      for (const m of [...mios, ...misRevisiones]) anotar(tipo, m.entityId, m.createdAt);
    }
  }

  const eventos: EventoActividad[] = [];
  const agregar = (clave: string, tipo: EventoActividad["tipo"], cuando: Date, usuarioId: number, frase: { pantalla: string; voz: string }) => {
    if (yo != null && usuarioId === yo) return;
    const quien = cortos.get(usuarioId) || "Alguien";
    eventos.push({
      clave, tipo, cuando, usuarioId, nombre: completos.get(usuarioId) || "Alguien", nombreCorto: quien,
      texto: `${quien} ${frase.pantalla}`, voz: `${quien} ${frase.voz}`,
    });
  };

  for (const e of entregas) {
    const que = nombrar({ tipo: e.entityType, id: e.entityId }, "la");
    agregar(`h-${e.id}`, "entrega", e.createdAt, e.userId, { pantalla: `envió a revisión ${que.pantalla}`, voz: `envió a revisión ${que.voz}` });
  }
  for (const c of comentarios) {
    const donde = nombrar({ tipo: c.entityType as "task" | "deadline", id: c.entityId }, "en la");
    const dicho = recortar(c.content, 110);
    const antes = primerMensajeMio.get(`${c.entityType}-${c.entityId}`);
    const verbo = antes != null && antes < new Date(c.createdAt).getTime() ? "te respondió" : "comentó";
    agregar(`c-${c.id}`, "comentario", c.createdAt, c.authorId, {
      pantalla: `${verbo} ${donde.pantalla}: “${dicho}”`,
      voz: `${verbo} ${donde.voz}: ${dicho}`,
    });
  }
  // Notificaciones marcadas sin abrir, una fila por cada una: sirven para
  // decir cuántas de las que alguien marcó de golpe eran mensajes de quien escucha.
  const marcadas = lecturas.filter(l => l.tipo === "notificacion_marcada");
  for (const l of lecturas) {
    if (l.tipo === "notificacion_marcada") continue;
    if (l.tipo === "notificaciones_marcadas") {
      const delLote = marcadas.filter(m => m.userId === l.userId && Math.abs(new Date(m.createdAt).getTime() - new Date(l.createdAt).getTime()) <= 5000);
      const mias = delLote.filter(m => yo != null && m.remitenteId === yo).length;
      // Con el detalle a la mano: si ninguna era de quien escucha, no es novedad para él.
      if (yo != null && delLote.length > 0 && mias === 0) continue;
      const frase = `marcó como leídas ${plural(l.cantidad, "notificación", "notificaciones")} sin abrirlas${mias > 0 ? `; ${mias === 1 ? "una era un mensaje tuyo" : `${mias} eran mensajes tuyos`}` : ""}`;
      agregar(`l-${l.id}`, "lecturas_marcadas", l.createdAt, l.userId, { pantalla: frase, voz: frase });
      continue;
    }
    // Lo que otra persona le escribió a alguien y ese alguien leyó no es novedad para quien escucha.
    if (yo != null && l.remitenteId != null && l.remitenteId !== yo) continue;
    const tuyo = yo != null && l.remitenteId === yo;
    const entidad = esEntidad(l.entityType) && l.entityId != null ? { tipo: l.entityType, id: l.entityId } : null;
    const de = nombrar(entidad, "de la");
    const accion =
      l.detalle === "correccion_solicitada" ? `leyó ${tuyo ? "tu" : "la"} observación de corrección`
      : l.detalle === "completar_solicitado" ? `leyó ${tuyo ? "tu" : "la"} observación para completar`
      : l.detalle === "aprobada" ? `vio ${tuyo ? "tu" : "la"} aprobación`
      : `leyó ${tuyo ? "tu" : "el"} comentario`;
    const tablero = l.detalle === "tablero_post" || entidad?.tipo === "board_post";
    const fraseTablero = l.detalle === "tablero_post" ? `leyó ${tuyo ? "tu" : "la"} publicación del tablero` : `leyó ${tuyo ? "tu" : "el"} comentario del tablero`;
    agregar(`l-${l.id}`, "lectura", l.createdAt, l.userId, tablero
      ? { pantalla: fraseTablero, voz: fraseTablero }
      : { pantalla: `${accion} ${de.pantalla}`.trim(), voz: `${accion} ${de.voz}`.trim() });
  }

  eventos.sort((a, b) => a.cuando.getTime() - b.cuando.getTime() || a.clave.localeCompare(b.clave));
  const limite = opciones.limite ?? 300;
  return eventos.length > limite ? eventos.slice(-limite) : eventos;
}

/** Una frase por persona con lo que hizo: "Jessica terminó 2 tareas,
 * comentó 1 vez y leyó 3 notificaciones." */
export function resumirActividadPorPersona(eventos: EventoActividad[]): string[] {
  const porPersona = new Map<number, { nombre: string; entregas: number; comentarios: number; lecturas: number }>();
  for (const e of eventos) {
    if (!porPersona.has(e.usuarioId)) porPersona.set(e.usuarioId, { nombre: e.nombreCorto, entregas: 0, comentarios: 0, lecturas: 0 });
    const p = porPersona.get(e.usuarioId)!;
    if (e.tipo === "entrega") p.entregas++;
    else if (e.tipo === "comentario") p.comentarios++;
    else p.lecturas++;
  }
  return Array.from(porPersona.values())
    .sort((a, b) => b.entregas - a.entregas || a.nombre.localeCompare(b.nombre, "es"))
    .map(p => `${p.nombre} ${enumerar([
      p.entregas > 0 ? `entregó ${plural(p.entregas, "trabajo", "trabajos")} para revisión` : "",
      p.comentarios > 0 ? `comentó ${plural(p.comentarios, "vez", "veces")}` : "",
      p.lecturas > 0 ? `revisó sus notificaciones ${plural(p.lecturas, "vez", "veces")}` : "",
    ].filter(Boolean))}.`);
}

// ---------------------------------------------------------------------
// Seguimiento: mensajes que envié y el equipo no ha leído
// ---------------------------------------------------------------------

export type MensajePendiente = {
  clave: string;
  /** "sin_leer": la notificación sigue sin abrir. "marcado_sin_abrir": la
   * marcó como leída con «marcar todas» y no ha abierto la tarea después. */
  estado: "sin_leer" | "marcado_sin_abrir";
  destinatarioId: number;
  tipo: string;
  /** "Comentario en la tarea «X»", "Devolución para corrección de la tarea «X»"… */
  descripcion: string;
  extracto: string | null;
  enviadoAt: Date;
  /** Días calendario (de Bogotá) desde que se envió. */
  dias: number;
  /** Ruta del portal donde está el mensaje, para ir a insistir. */
  enlace: string | null;
};

export type SeguimientoMensajes = {
  total: number; sinLeer: number; marcadosSinAbrir: number;
  porPersona: { usuarioId: number; nombre: string; nombreCorto: string; total: number; sinLeer: number; marcadosSinAbrir: number; masAntiguoDias: number }[];
  mensajes: (MensajePendiente & { destinatario: string })[];
  /** Listo para leer en voz alta. */
  frases: string[];
};

const haceDias = (dias: number) => (dias <= 0 ? "de hoy" : dias === 1 ? "de ayer" : `de hace ${dias} días`);

/** Arma el resumen por persona y las frases, a partir de los mensajes pendientes. */
export function armarSeguimiento(mensajes: MensajePendiente[], nombres: Map<number, { nombre: string; nombreCorto: string }>): SeguimientoMensajes {
  const persona = (id: number) => nombres.get(id) || { nombre: "Alguien", nombreCorto: "Alguien" };
  const grupos = new Map<number, SeguimientoMensajes["porPersona"][number]>();
  for (const m of mensajes) {
    if (!grupos.has(m.destinatarioId)) grupos.set(m.destinatarioId, { usuarioId: m.destinatarioId, ...persona(m.destinatarioId), total: 0, sinLeer: 0, marcadosSinAbrir: 0, masAntiguoDias: 0 });
    const g = grupos.get(m.destinatarioId)!;
    g.total++;
    if (m.estado === "sin_leer") g.sinLeer++; else g.marcadosSinAbrir++;
    g.masAntiguoDias = Math.max(g.masAntiguoDias, m.dias);
  }
  // Primero quien más tiene; en empate, el que lleva más tiempo sin leer.
  const porPersona = Array.from(grupos.values()).sort((a, b) => b.total - a.total || b.masAntiguoDias - a.masAntiguoDias || a.nombre.localeCompare(b.nombre, "es"));
  const orden = new Map(porPersona.map((g, i) => [g.usuarioId, i]));
  const ordenados = [...mensajes]
    .sort((a, b) => orden.get(a.destinatarioId)! - orden.get(b.destinatarioId)! || a.enviadoAt.getTime() - b.enviadoAt.getTime())
    .map(m => ({ ...m, destinatario: persona(m.destinatarioId).nombre }));
  const sinLeer = mensajes.filter(m => m.estado === "sin_leer").length;

  const frases = mensajes.length === 0
    ? ["Mensajes: todo lo que le has escrito al equipo está leído."]
    : [
        `Mensajes tuyos pendientes de lectura: ${mensajes.length}.`,
        ...porPersona.map(g => {
          const partes = [
            g.sinLeer > 0 ? `${g.sinLeer} sin leer` : "",
            g.marcadosSinAbrir > 0 ? `${g.marcadosSinAbrir === 1 ? "1 marcado como leído sin abrirlo" : `${g.marcadosSinAbrir} marcados como leídos sin abrirlos`}` : "",
          ].filter(Boolean);
          return `${g.nombreCorto}: ${enumerar(partes)}; el más antiguo es ${haceDias(g.masAntiguoDias)}.`;
        }),
      ];
  return { total: mensajes.length, sinLeer, marcadosSinAbrir: mensajes.length - sinLeer, porPersona, mensajes: ordenados, frases };
}

const DIAS_SEGUIMIENTO_MARCADOS = 45;

/** Los mensajes que `usuarioId` le escribió al equipo y siguen sin leerse:
 * comentarios, devoluciones para corregir o completar, aprobaciones con
 * observación y publicaciones del tablero. */
export async function seguimientoMensajes(usuarioId: number, ahora: Date = new Date()): Promise<SeguimientoMensajes> {
  const db = await getDb();
  if (!db) return armarSeguimiento([], new Map());
  const hoy = diaBogota(ahora);
  const diasDesde = (cuando: Date) => Math.max(0, Math.round((new Date(`${hoy}T00:00:00Z`).getTime() - new Date(`${diaBogota(new Date(cuando))}T00:00:00Z`).getTime()) / DIA_MS));

  const [listaUsuarios, sinLeer, actividad] = await Promise.all([
    db.select({ id: users.id, name: users.name, isActive: users.isActive }).from(users),
    db.select().from(notifications).where(and(eq(notifications.isRead, false), ne(notifications.userId, usuarioId))),
    // Sin la migración de esta tabla el seguimiento sale solo con las no leídas.
    db.select().from(oficinaActividad).where(and(
      eq(oficinaActividad.remitenteId, usuarioId),
      inArray(oficinaActividad.tipo, ["notificacion_marcada", "notificacion_leida"]),
      gte(oficinaActividad.createdAt, new Date(ahora.getTime() - DIAS_SEGUIMIENTO_MARCADOS * DIA_MS)),
    )).catch(() => [] as (typeof oficinaActividad.$inferSelect)[]),
  ]);
  const activos = new Set(listaUsuarios.filter(u => u.isActive).map(u => u.id));
  const cortos = nombresCortos(listaUsuarios);
  const nombres = new Map(listaUsuarios.map(u => [u.id, { nombre: u.name || "Sin nombre", nombreCorto: cortos.get(u.id) || u.name || "Sin nombre" }]));

  // 1. Notificaciones sin leer cuyo remitente es este usuario.
  const candidatas = sinLeer.filter(n => activos.has(n.userId));
  const remitentes = await inferirRemitentes(candidatas);
  const mias = candidatas.filter(n => remitentes.get(n.id) === usuarioId
    // Una aprobación sin observación no es un mensaje que haya que leer.
    && (n.type !== "aprobada" || !!n.message?.trim()));

  // 2. Marcadas como leídas sin abrir, que después no se han abierto.
  const esEntidad = (tipo: string | null): tipo is Entidad["tipo"] => tipo === "task" || tipo === "deadline" || tipo === "board_post";
  const claveActividad = (a: { userId: number; entityType: string | null; entityId: number | null; detalle: string | null }) => `${a.userId}|${a.entityType}|${a.entityId}|${a.detalle}`;
  const ultimaLectura = new Map<string, number>();
  for (const a of actividad) if (a.tipo === "notificacion_leida") ultimaLectura.set(claveActividad(a), Math.max(ultimaLectura.get(claveActividad(a)) || 0, new Date(a.createdAt).getTime()));
  const marcadas = actividad.filter(a =>
    a.tipo === "notificacion_marcada" && activos.has(a.userId) && esEntidad(a.entityType) && a.entityId != null && a.detalle !== "aprobada"
    && (ultimaLectura.get(claveActividad(a)) || 0) < new Date(a.createdAt).getTime());

  // Nombres de las tareas y vencimientos, y el cliente de cada vencimiento (para el enlace).
  const entidades: Entidad[] = [
    ...mias.map(n => ({ tipo: n.entityType, id: n.entityId })),
    ...marcadas.map(a => ({ tipo: a.entityType as Entidad["tipo"], id: a.entityId! })),
  ];
  const nombrar = await cargarNombresEntidades(db, entidades);
  const idsVencimientos = Array.from(new Set(entidades.filter(e => e.tipo === "deadline").map(e => e.id)));
  const clienteDeVencimiento = new Map((idsVencimientos.length === 0 ? [] : await db.select({ id: taxDeadlines.id, clientId: taxDeadlines.clientId }).from(taxDeadlines).where(inArray(taxDeadlines.id, idsVencimientos))).map(v => [v.id, v.clientId]));

  const descripcion = (tipo: string, e: Entidad): string => {
    if (tipo === "tablero_post") return "Publicación en el tablero";
    if (tipo === "correccion_solicitada") return `Devolución para corrección ${nombrar(e, "de la").pantalla}`;
    if (tipo === "completar_solicitado") return `Observación para completar ${nombrar(e, "de la").pantalla}`;
    if (tipo === "aprobada") return `Aprobación con observación ${nombrar(e, "de la").pantalla}`;
    return `Comentario ${nombrar(e, "en la").pantalla}`;
  };
  const enlace = (e: Entidad): string | null => {
    if (e.tipo === "task") return `/tareas?taskId=${e.id}`;
    if (e.tipo === "board_post") return `/tablero?postId=${e.id}`;
    const clientId = clienteDeVencimiento.get(e.id);
    return clientId ? `/vencimientos?clientId=${clientId}&deadlineId=${e.id}` : "/vencimientos";
  };

  const mensajes: MensajePendiente[] = [
    ...mias.map((n): MensajePendiente => {
      const e = { tipo: n.entityType, id: n.entityId };
      return {
        clave: `n-${n.id}`, estado: "sin_leer", destinatarioId: n.userId, tipo: n.type, descripcion: descripcion(n.type, e),
        extracto: n.message?.trim() ? recortar(n.message, 160) : null, enviadoAt: new Date(n.createdAt), dias: diasDesde(n.createdAt), enlace: enlace(e),
      };
    }),
    ...marcadas.map((a): MensajePendiente => {
      const e = { tipo: a.entityType as Entidad["tipo"], id: a.entityId! };
      const enviado = new Date(a.mensajeAt ?? a.createdAt);
      return {
        clave: `a-${a.id}`, estado: "marcado_sin_abrir", destinatarioId: a.userId, tipo: a.detalle || "comentario", descripcion: descripcion(a.detalle || "comentario", e),
        extracto: null, enviadoAt: enviado, dias: diasDesde(enviado), enlace: enlace(e),
      };
    }),
  ];
  return armarSeguimiento(mensajes, nombres);
}

// ---------------------------------------------------------------------
// Informe del equipo
// ---------------------------------------------------------------------

export type FilaColaborador = {
  userId: number; nombre: string; nombreCorto: string;
  /** Tareas asignadas sin terminar (pendientes, en progreso o vencidas). */
  porTerminar: number;
  /** De esas, cuántas ya pasaron su fecha límite. */
  vencidas: number;
  /** Tareas y vencimientos devueltos para corrección (mismo criterio de Revisión → Devueltas). */
  devueltas: number;
  /** Tareas y vencimientos a los que les falta una acción (Revisión → Por completar). */
  porCompletar: number;
  horas: HorasPersona;
  eficiencia: DatosEficiencia & Puntaje;
  /** Posición en el ranking (1 = el más eficiente); null si no hay base para puntuarlo. */
  posicion: number | null;
};

export type InformeEquipo = {
  generadoEn: Date;
  hoy: string;
  diaAnterior: { clave: string; etiqueta: string };
  colaboradores: FilaColaborador[];
  /** Trabajo sin responsable asignado — para que los totales cuadren con Tareas y Revisión. */
  sinResponsable: { porTerminar: number; vencidas: number; devueltas: number; porCompletar: number };
  totales: { porTerminar: number; vencidas: number; devueltas: number; porCompletar: number };
  actividadHoy: EventoActividad[];
  /** Mensajes de quien pide el informe que el equipo no ha leído. */
  mensajes?: SeguimientoMensajes;
  /** El informe listo para leerse en voz alta, frase por frase. */
  frases: string[];
};

export async function calcularInformeEquipo(opciones: { ahora?: Date; excluirUsuarioId?: number } = {}): Promise<InformeEquipo> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const ahora = opciones.ahora ?? new Date();
  const hoy = diaBogota(ahora);
  const primeroDeMes = `${hoy.slice(0, 8)}01`;
  const lunes = lunesDeLaSemana(hoy);
  const desdeRanking = new Date(inicioDiaBogota(hoy).getTime() - DIAS_RANKING * DIA_MS);
  // Las marcas se traen desde el más antiguo de los tres inicios (el lunes
  // puede caer en el mes anterior; el "día anterior" también).
  const desdeMarcas = inicioDiaBogota([primeroDeMes, lunes, sumarDias(hoy, -6)].sort()[0]);
  const hoyUtcMedianoche = new Date(`${hoy}T00:00:00Z`); // convención de dueDate

  const [
    listaUsuarios, tareasAbiertas, tareasDevueltas, vencimientosDevueltos,
    tareasEntregadas, vencimientosEntregados, eventos, marcas, actividadHoy,
  ] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users),
    db.select({ assignedToId: tasks.assignedToId, dueDate: tasks.dueDate }).from(tasks)
      .where(inArray(tasks.status, ["pendiente", "en_progreso", "vencida"])),
    db.select({ assignedToId: tasks.assignedToId, reviewStatus: tasks.reviewStatus }).from(tasks)
      .where(inArray(tasks.reviewStatus, ["correccion", "completar"])),
    db.select({ managerId: clients.managerId, reviewStatus: taxDeadlines.reviewStatus }).from(taxDeadlines)
      .innerJoin(clients, eq(taxDeadlines.clientId, clients.id))
      .where(inArray(taxDeadlines.reviewStatus, ["correccion", "completar"])),
    db.select({ completedById: tasks.completedById, completedAt: tasks.completedAt, dueDate: tasks.dueDate }).from(tasks)
      .where(and(eq(tasks.status, "completada"), gte(tasks.completedAt, desdeRanking))),
    db.select({ completedById: taxDeadlines.completedById, completedAt: taxDeadlines.completedAt, dueDate: taxDeadlines.dueDate }).from(taxDeadlines)
      .where(and(eq(taxDeadlines.status, "completado"), gte(taxDeadlines.completedAt, desdeRanking))),
    // Entregas y devoluciones. Se traen 30 días extra hacia atrás solo para
    // saber QUIÉN había entregado lo que luego se devolvió.
    db.select({
      entityType: historyEvents.entityType, entityId: historyEvents.entityId, eventType: historyEvents.eventType,
      userId: historyEvents.userId, createdAt: historyEvents.createdAt, id: historyEvents.id,
    }).from(historyEvents)
      .where(and(
        or(eq(historyEvents.eventType, "completada"), eq(historyEvents.eventType, "correccion_solicitada")),
        gte(historyEvents.createdAt, new Date(desdeRanking.getTime() - DIAS_RANKING * DIA_MS)),
      )),
    db.select({ userId: timeEntries.userId, type: timeEntries.type, timestamp: timeEntries.timestamp }).from(timeEntries)
      .where(and(gte(timeEntries.timestamp, desdeMarcas), lt(timeEntries.timestamp, new Date(inicioDiaBogota(hoy).getTime() + DIA_MS)))),
    listarActividad({ desde: inicioDiaBogota(hoy), excluirUsuarioId: opciones.excluirUsuarioId }),
  ]);

  // "Día anterior": ayer; pero si ayer nadie marcó jornada (domingo,
  // festivo), el último día con marcas de los 5 anteriores.
  const diasConMarcas = new Set(marcas.map(m => diaBogota(new Date(m.timestamp))));
  let claveAnterior = sumarDias(hoy, -1);
  for (let i = 1; i <= 5; i++) {
    const candidato = sumarDias(hoy, -i);
    if (diasConMarcas.has(candidato)) { claveAnterior = candidato; break; }
  }
  const diaAnterior = { clave: claveAnterior, etiqueta: claveAnterior === sumarDias(hoy, -1) ? "ayer" : `el ${fechaLarga(claveAnterior)}` };
  const horas = resumirHoras(marcas, { hoy, diaAnterior: claveAnterior, lunes, primeroDeMes });

  const cortos = nombresCortos(listaUsuarios);
  const nuevaFila = (userId: number, nombre: string): FilaColaborador => ({
    userId, nombre, nombreCorto: cortos.get(userId) || nombre,
    porTerminar: 0, vencidas: 0, devueltas: 0, porCompletar: 0,
    horas: horas.get(userId) || { diaAnteriorMs: 0, semanaMs: 0, mesMs: 0, diasIncompletos: 0 },
    eficiencia: { entregas: 0, devoluciones: 0, entregasConFecha: 0, aTiempo: 0, porTerminar: 0, vencidas: 0, puntaje: null, puntualidad: null, calidad: null, alDia: 1 },
    posicion: null,
  });
  const filas = new Map(listaUsuarios.map(u => [u.id, nuevaFila(u.id, u.name || "Sin nombre")]));
  const sinResponsable = { porTerminar: 0, vencidas: 0, devueltas: 0, porCompletar: 0 };
  const cubo = (userId: number | null | undefined) => (userId != null && filas.get(userId)) || null;

  for (const t of tareasAbiertas) {
    const destino = cubo(t.assignedToId) ?? sinResponsable;
    destino.porTerminar++;
    if (t.dueDate && new Date(t.dueDate) < hoyUtcMedianoche) destino.vencidas++;
  }
  for (const t of tareasDevueltas) {
    const destino = cubo(t.assignedToId) ?? sinResponsable;
    if (t.reviewStatus === "correccion") destino.devueltas++; else destino.porCompletar++;
  }
  for (const v of vencimientosDevueltos) {
    const destino = cubo(v.managerId) ?? sinResponsable;
    if (v.reviewStatus === "correccion") destino.devueltas++; else destino.porCompletar++;
  }

  // Puntualidad: entregas que siguen aprobadas/en revisión, con su fecha límite.
  for (const e of [...tareasEntregadas, ...vencimientosEntregados]) {
    const fila = cubo(e.completedById);
    if (!fila || !e.completedAt || !e.dueDate) continue;
    fila.eficiencia.entregasConFecha++;
    if (entregadaATiempo(e.completedAt, e.dueDate)) fila.eficiencia.aTiempo++;
  }
  // Calidad: cada devolución se le carga a quien había hecho la última
  // entrega de ese mismo trabajo.
  const ultimoQueEntrego = new Map<string, number>();
  const enOrden = [...eventos].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  for (const ev of enOrden) {
    const claveEntidad = `${ev.entityType}-${ev.entityId}`;
    const dentroDelPeriodo = ev.createdAt >= desdeRanking;
    if (ev.eventType === "completada") {
      ultimoQueEntrego.set(claveEntidad, ev.userId);
      if (dentroDelPeriodo) { const fila = cubo(ev.userId); if (fila) fila.eficiencia.entregas++; }
    } else if (dentroDelPeriodo) {
      const fila = cubo(ultimoQueEntrego.get(claveEntidad));
      if (fila) fila.eficiencia.devoluciones++;
    }
  }

  const colaboradores: FilaColaborador[] = [];
  filas.forEach((fila) => {
    fila.eficiencia.porTerminar = fila.porTerminar;
    fila.eficiencia.vencidas = fila.vencidas;
    Object.assign(fila.eficiencia, calcularPuntaje(fila.eficiencia));
    const tieneAlgo = fila.porTerminar + fila.devueltas + fila.porCompletar + fila.eficiencia.entregas + fila.eficiencia.devoluciones > 0
      || fila.horas.mesMs + fila.horas.semanaMs + fila.horas.diaAnteriorMs > 0;
    if (tieneAlgo) colaboradores.push(fila);
  });

  // Ranking: mayor puntaje primero; en empate, quien más entregó.
  const puntuados = colaboradores.filter(f => f.eficiencia.puntaje != null)
    .sort((a, b) => b.eficiencia.puntaje! - a.eficiencia.puntaje! || b.eficiencia.entregas - a.eficiencia.entregas || a.nombre.localeCompare(b.nombre, "es"));
  puntuados.forEach((f, i) => { f.posicion = i + 1; });
  colaboradores.sort((a, b) => (a.posicion ?? 999) - (b.posicion ?? 999) || a.nombre.localeCompare(b.nombre, "es"));

  const totales = colaboradores.reduce((t, f) => ({
    porTerminar: t.porTerminar + f.porTerminar, vencidas: t.vencidas + f.vencidas,
    devueltas: t.devueltas + f.devueltas, porCompletar: t.porCompletar + f.porCompletar,
  }), { ...sinResponsable });

  // El seguimiento de mensajes es de quien pide el informe; si falla, el
  // resto del informe sale igual.
  const mensajes = opciones.excluirUsuarioId != null
    ? await seguimientoMensajes(opciones.excluirUsuarioId, ahora).catch((error: any) => {
        console.error("[Oficina] No se pudo armar el seguimiento de mensajes:", String(error?.message || error).slice(0, 200));
        return undefined;
      })
    : undefined;
  const informe: InformeEquipo = { generadoEn: ahora, hoy, diaAnterior, colaboradores, sinResponsable, totales, actividadHoy, mensajes, frases: [] };
  informe.frases = armarFrasesInforme(informe);
  return informe;
}

/** El informe en frases cortas, listo para leer en voz alta. */
export function armarFrasesInforme(informe: Omit<InformeEquipo, "frases">): string[] {
  const frases: string[] = [`Informe del equipo, ${fechaLarga(informe.hoy)}.`];

  // 1. Lo que ha pasado hoy.
  if (informe.actividadHoy.length === 0) frases.push("Hoy todavía no hay novedades del equipo.");
  else {
    frases.push(`Novedades de hoy: ${plural(informe.actividadHoy.length, "movimiento", "movimientos")}.`);
    frases.push(...resumirActividadPorPersona(informe.actividadHoy));
  }

  // 2. Pendientes por persona.
  const t = informe.totales;
  frases.push(`Pendientes. En total hay ${plural(t.porTerminar, "tarea por terminar", "tareas por terminar")}, ${plural(t.devueltas, "devuelta para corrección", "devueltas para corrección")} y ${t.porCompletar} por completar.`);
  for (const f of informe.colaboradores) {
    const partes = [
      f.porTerminar > 0 ? `${f.porTerminar} por terminar` : "",
      f.vencidas > 0 ? plural(f.vencidas, "vencida", "vencidas") : "",
      f.devueltas > 0 ? plural(f.devueltas, "devuelta", "devueltas") : "",
      f.porCompletar > 0 ? `${f.porCompletar} por completar` : "",
    ].filter(Boolean);
    if (partes.length > 0) frases.push(`${f.nombreCorto}: ${enumerar(partes)}.`);
  }
  const s = informe.sinResponsable;
  if (s.porTerminar + s.devueltas + s.porCompletar > 0) {
    frases.push(`Sin responsable asignado: ${enumerar([
      s.porTerminar > 0 ? `${s.porTerminar} por terminar` : "",
      s.devueltas > 0 ? plural(s.devueltas, "devuelta", "devueltas") : "",
      s.porCompletar > 0 ? `${s.porCompletar} por completar` : "",
    ].filter(Boolean))}.`);
  }

  // 3. Mensajes de quien escucha que siguen sin leerse.
  if (informe.mensajes) frases.push(...informe.mensajes.frases);

  // 4. Horas.
  const conHoras = informe.colaboradores.filter(f => f.horas.mesMs + f.horas.semanaMs + f.horas.diaAnteriorMs > 0);
  if (conHoras.length === 0) frases.push("Horas trabajadas: nadie ha marcado jornada este mes.");
  else {
    frases.push("Horas trabajadas.");
    for (const f of conHoras) {
      frases.push(`${f.nombreCorto}: ${informe.diaAnterior.etiqueta}, ${duracionHablada(f.horas.diaAnteriorMs)}; esta semana, ${duracionHablada(f.horas.semanaMs)}; este mes, ${duracionHablada(f.horas.mesMs)}.`);
    }
    const sinMarcar = informe.colaboradores.filter(f => !conHoras.includes(f)).map(f => f.nombreCorto);
    if (sinMarcar.length > 0) frases.push(`Sin marcaciones de jornada: ${enumerar(sinMarcar)}.`);
  }

  // 5. Ranking.
  const puntuados = informe.colaboradores.filter(f => f.posicion != null);
  if (puntuados.length === 0) frases.push(`Ranking de eficiencia: todavía no hay suficientes entregas en los últimos ${DIAS_RANKING} días para armarlo.`);
  else {
    frases.push(`Ranking de eficiencia de los últimos ${DIAS_RANKING} días.`);
    puntuados.forEach((f, i) => {
      frases.push(`${ORDINALES[i] || `Puesto ${i + 1}`}: ${f.nombreCorto}, con ${plural(f.eficiencia.puntaje!, "punto", "puntos")}.`);
    });
    const sinBase = informe.colaboradores.filter(f => f.posicion == null && f.eficiencia.entregas > 0).map(f => f.nombreCorto);
    if (sinBase.length > 0) frases.push(`Con muy pocas entregas para puntuar: ${enumerar(sinBase)}.`);
  }
  return frases;
}

/** El mismo informe como texto plano, para dárselo de contexto al chat. */
export async function contextoChatEstadista(excluirUsuarioId?: number): Promise<string> {
  const informe = await calcularInformeEquipo({ excluirUsuarioId });
  const lineas = informe.colaboradores.map(f => [
    `- ${f.nombre}:`,
    `${f.porTerminar} por terminar (${f.vencidas} vencidas), ${f.devueltas} devueltas, ${f.porCompletar} por completar;`,
    `horas ${informe.diaAnterior.etiqueta} ${duracionHablada(f.horas.diaAnteriorMs)}, semana ${duracionHablada(f.horas.semanaMs)}, mes ${duracionHablada(f.horas.mesMs)};`,
    f.posicion != null
      ? `puesto ${f.posicion} del ranking con ${f.eficiencia.puntaje} puntos (${f.eficiencia.entregas} entregas, ${f.eficiencia.devoluciones} devoluciones, ${f.eficiencia.aTiempo} de ${f.eficiencia.entregasConFecha} a tiempo).`
      : `sin puntaje (${f.eficiencia.entregas} entregas en ${DIAS_RANKING} días).`,
  ].join(" "));
  return [
    `Estado del equipo (cifras reales al ${fechaLarga(informe.hoy)}; el puntaje es 50 % entregas a tiempo, 30 % entregas sin devolución y 20 % sin tareas vencidas, sobre los últimos ${DIAS_RANKING} días):`,
    ...lineas,
    "",
    informe.mensajes
      ? (informe.mensajes.total === 0
        ? "Mensajes de Arlex al equipo: todos leídos."
        : `Mensajes de Arlex al equipo que siguen sin leerse (${informe.mensajes.total}):\n${informe.mensajes.mensajes.map(m => `- ${m.destinatario}: ${m.descripcion}, enviado hace ${m.dias} día(s), ${m.estado === "sin_leer" ? "sin leer" : "marcado como leído sin abrirlo"}.`).join("\n")}`)
      : "",
    "",
    informe.actividadHoy.length > 0
      ? `Actividad de hoy:\n${informe.actividadHoy.map(e => `- ${e.cuando.toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "numeric", minute: "2-digit" })} ${e.texto}`).join("\n")}`
      : "Actividad de hoy: ninguna todavía.",
  ].join("\n");
}
