import { useCallback, useEffect, useState } from "react";
import { useSearch } from "wouter";

/** A dónde lleva una notificación: la tarea, el vencimiento o la
 * publicación del tablero, y qué hay que resaltar ahí (el comentario o la
 * observación que se notificó).
 *
 * Antes el destino viajaba solo en la URL ("/tareas?taskId=X") y cada
 * página lo leía UNA vez, al montarse. Si ya se estaba en esa página, al
 * hacer clic en la campanita la URL cambiaba pero la página no se enteraba
 * y la tarea no se abría. Ahora el destino se guarda aquí y se avisa con
 * un evento, así que la página lo atiende esté o no montada. La URL sigue
 * sirviendo (enlaces del Oficina, recargar la página) como respaldo. */

export type TipoEntidad = "task" | "deadline" | "board_post";
export type Destino = {
  entityType: TipoEntidad;
  entityId: number;
  /** Cliente del vencimiento (la página de vencimientos lo necesita para cargarlos). */
  clientId?: number | null;
  /** Tipo de notificación: comentario, correccion_solicitada, aprobada… */
  tipo?: string | null;
  /** Texto notificado: el comentario o la observación de la revisión. */
  mensaje?: string | null;
  /** Cuándo se envió (para encontrar el comentario exacto si hay varios iguales). */
  cuando?: string | Date | null;
};

const EVENTO = "areda-destino-notificacion";
let pendiente: Destino | null = null;

const RUTAS: Record<TipoEntidad, (d: Destino) => string> = {
  task: (d) => `/tareas?taskId=${d.entityId}`,
  deadline: (d) => (d.clientId ? `/vencimientos?clientId=${d.clientId}&deadlineId=${d.entityId}` : "/vencimientos"),
  board_post: (d) => `/tablero?postId=${d.entityId}`,
};

/** Lleva a la tarea / vencimiento / publicación y deja dicho qué resaltar. */
export function irADestino(destino: Destino, navegar: (ruta: string) => void): void {
  pendiente = destino;
  navegar(RUTAS[destino.entityType](destino));
  // Si la página ya estaba abierta, no se vuelve a montar: el evento le avisa.
  window.dispatchEvent(new Event(EVENTO));
}

const PARAM: Record<TipoEntidad, string> = { task: "taskId", deadline: "deadlineId", board_post: "postId" };

function leer(entityType: TipoEntidad): Destino | null {
  if (pendiente?.entityType === entityType) return pendiente;
  // Respaldo: el destino en la URL (enlaces directos o recarga de la página).
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get(PARAM[entityType]));
  if (!id) return null;
  const clientId = Number(params.get("clientId")) || null;
  return { entityType, entityId: id, clientId };
}

/** El destino pendiente para esta página, y la función para darlo por
 * atendido (limpia también la URL, para que recargar no lo vuelva a abrir). */
export function useDestinoNotificacion(entityType: TipoEntidad): [Destino | null, () => void] {
  const [destino, setDestino] = useState<Destino | null>(() => leer(entityType));
  const search = useSearch();
  useEffect(() => {
    const alAvisar = () => setDestino(leer(entityType));
    window.addEventListener(EVENTO, alAvisar);
    return () => window.removeEventListener(EVENTO, alAvisar);
  }, [entityType]);
  // La URL cambió sin pasar por irADestino (ej. un enlace con ?taskId=).
  useEffect(() => { const d = leer(entityType); if (d) setDestino(d); }, [search, entityType]);

  const atendido = useCallback(() => {
    if (pendiente?.entityType === entityType) pendiente = null;
    const params = new URLSearchParams(window.location.search);
    if (params.has(PARAM[entityType])) window.history.replaceState({}, "", window.location.pathname);
    setDestino(null);
  }, [entityType]);
  return [destino, atendido];
}

/** De una lista de comentarios, el que corresponde a lo notificado: mismo
 * texto (las observaciones de revisión se guardan con un prefijo como
 * "[Devuelta para corrección] …"), el más cercano a la hora del aviso. */
export function comentarioNotificado<T extends { id: number; content: string; createdAt: string | Date }>(
  comentarios: T[], mensaje: string | null | undefined, cuando: string | Date | null | undefined,
): T | null {
  const texto = (mensaje || "").trim();
  if (!texto || comentarios.length === 0) return null;
  const candidatos = comentarios.filter(c => {
    const contenido = (c.content || "").trim();
    return contenido === texto || contenido.endsWith(texto);
  });
  if (candidatos.length === 0) return null;
  if (!cuando) return candidatos[candidatos.length - 1];
  const t = new Date(cuando).getTime();
  return candidatos.reduce((mejor, c) => (Math.abs(new Date(c.createdAt).getTime() - t) < Math.abs(new Date(mejor.createdAt).getTime() - t) ? c : mejor));
}
