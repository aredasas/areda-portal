import { google, gmail_v1 } from "googleapis";
import { getServiceAccountCredentials } from "./googleDrive";

/** Acceso a Gmail de los buzones del Google Workspace de la firma, con la
 * MISMA cuenta de servicio que ya usa Drive (googleDrive.ts) — pero aquí la
 * cuenta de servicio actúa EN NOMBRE de un buzón concreto ("delegación en
 * todo el dominio"), así que no hay inicio de sesión ni tokens por usuario
 * que se venzan.
 *
 * Requisitos, una sola vez (los pasos se muestran en Oficina → Agente de
 * Correo → Buzones):
 *   1. API de Gmail activada en el proyecto de Google Cloud de la cuenta
 *      de servicio.
 *   2. En admin.google.com → Seguridad → Controles de API → Delegación en
 *      todo el dominio: autorizar el ID de cliente de la cuenta de
 *      servicio con EXACTAMENTE los permisos de GMAIL_SCOPES.
 *
 * Permiso: gmail.modify — leer, crear borradores, poner/quitar etiquetas
 * (mover a la carpeta de un cliente) y enviar a la Papelera. NO permite
 * borrar definitivamente. Técnicamente también dejaría enviar, pero este
 * módulo NO tiene ninguna función que envíe: los borradores quedan en el
 * buzón para que una persona los revise y los envíe.
 *
 * Compatibilidad: la primera versión del agente pedía dos permisos más
 * limitados (GMAIL_SCOPES_ANTERIORES: leer + borradores). Un buzón que
 * todavía tenga solo esos sigue funcionando para leer y redactar (nivel
 * "basico"); mover y eliminar exigen el permiso nuevo (nivel "completo"). */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const GMAIL_SCOPES_ANTERIORES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

/** Error que ya viene redactado para el usuario: conBuzon lo deja pasar tal cual. */
export class ErrorGmailDirecto extends Error {
  constructor(mensaje: string, public readonly motivo: "permiso_insuficiente" | "carpeta_inexistente") { super(mensaje); }
}

export type MensajeGmail = {
  id: string;
  threadId: string;
  remitenteNombre: string | null;
  remitenteEmail: string;
  /** A quién responder: Reply-To si viene, si no el remitente. */
  responderA: string;
  para: string;
  asunto: string;
  fecha: Date;
  snippet: string;
  /** Cuerpo en texto plano, sin el historial citado, recortado. */
  texto: string;
  /** Encabezado Message-ID (para enlazar la respuesta al hilo). */
  messageIdHeader: string | null;
  references: string | null;
  /** Boletín / publicidad / envío masivo según sus encabezados y etiquetas. */
  esMasivo: boolean;
  etiquetas: string[];
};

// ---------------------------------------------------------------------
// Funciones puras (sin red) — cubiertas por server/gmail.test.ts
// ---------------------------------------------------------------------

export function decodificarBase64Url(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

/** Decodifica "palabras codificadas" RFC 2047 (=?UTF-8?B?...?= y ?Q?) por si
 * un encabezado llega sin decodificar. Texto normal pasa intacto. */
export function decodificarEncabezado(valor: string | null | undefined): string {
  if (!valor) return "";
  return valor
    // Entre dos palabras codificadas seguidas, el espacio no cuenta.
    .replace(/(\?=)\s+(=\?)/g, "$1$2")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_todo, charset: string, tipo: string, contenido: string) => {
      try {
        const bytes = tipo.toUpperCase() === "B"
          ? Buffer.from(contenido, "base64")
          : Buffer.from(contenido.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1");
        const cs = charset.toLowerCase();
        return bytes.toString(cs === "iso-8859-1" || cs === "latin1" || cs === "windows-1252" ? "latin1" : "utf-8");
      } catch {
        return contenido;
      }
    });
}

/** `"Pérez, Ana" <ana@cliente.co>` → { nombre: "Pérez, Ana", email: "ana@cliente.co" }.
 * Si no se reconoce ningún correo, `email` queda vacío. */
export function parsearDireccion(valor: string | null | undefined): { nombre: string | null; email: string } {
  const texto = decodificarEncabezado(valor).trim();
  if (!texto) return { nombre: null, email: "" };
  const conAngulos = texto.match(/^(.*)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
  if (conAngulos) {
    const nombre = conAngulos[1].trim().replace(/^["']+|["']+$/g, "").trim();
    return { nombre: nombre || null, email: conAngulos[2].toLowerCase() };
  }
  const suelto = texto.match(/[^\s<>"',;]+@[^\s<>"',;]+/);
  return { nombre: null, email: suelto ? suelto[0].toLowerCase() : "" };
}

/** HTML de un correo → texto legible (sin estilos, scripts ni etiquetas). */
export function htmlATexto(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, n: string) => { try { return String.fromCodePoint(Number(n)); } catch { return " "; } })
    .replace(/&[a-z]+;/gi, " ");
}

/** Recorre las partes MIME y devuelve el cuerpo: primero text/plain; si no
 * hay, el text/html convertido a texto. Ignora adjuntos. */
export function extraerTexto(payload: gmail_v1.Schema$MessagePart | null | undefined): string {
  if (!payload) return "";
  let plano = "";
  let html = "";
  const visitar = (parte: gmail_v1.Schema$MessagePart) => {
    const esAdjunto = !!parte.filename;
    if (!esAdjunto && parte.body?.data) {
      if (parte.mimeType === "text/plain" && !plano) plano = decodificarBase64Url(parte.body.data);
      else if (parte.mimeType === "text/html" && !html) html = decodificarBase64Url(parte.body.data);
    }
    for (const hija of parte.parts || []) visitar(hija);
  };
  visitar(payload);
  return plano.trim() ? plano : htmlATexto(html);
}

/** Marcas donde empieza el historial citado de una respuesta — de ahí en
 * adelante es texto de correos anteriores, que solo mete ruido. */
const MARCAS_CITA = [
  /^\s*El .{5,120} escribió:\s*$/im,
  /^\s*On .{5,120} wrote:\s*$/im,
  /^\s*-{2,}\s*(Mensaje original|Original Message|Forwarded message|Mensaje reenviado)\s*-{2,}/im,
  /^\s*De:\s.+\r?\n\s*(Enviado|Enviado el|Fecha):\s/im,
  /^\s*From:\s.+\r?\n\s*(Sent|Date):\s/im,
];

/** Limpia el cuerpo para la IA: sin historial citado, sin líneas ">" y con
 * los espacios compactados; recortado a `max` caracteres. */
export function limpiarCuerpo(texto: string, max: number): string {
  let limpio = texto.replace(/\r\n?/g, "\n");
  let corte = limpio.length;
  for (const marca of MARCAS_CITA) {
    const m = marca.exec(limpio);
    // Un corte en la posición 0 dejaría el correo vacío (ej. un reenvío
    // cuyo contenido ES el mensaje citado) — en ese caso no se corta.
    if (m && m.index > 0 && m.index < corte) corte = m.index;
  }
  limpio = limpio.slice(0, corte)
    .split("\n").filter(linea => !/^\s*>/.test(linea)).join("\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return limpio.length > max ? limpio.slice(0, max).trimEnd() + " […]" : limpio;
}

export function asuntoDeRespuesta(asunto: string): string {
  const limpio = asunto.trim();
  if (!limpio) return "Re:";
  return /^re\s*:/i.test(limpio) ? limpio : `Re: ${limpio}`;
}

/** Un valor de encabezado nunca puede traer saltos de línea — si vinieran
 * (el asunto y el remitente salen de un correo ajeno), permitirían colar
 * encabezados extra en el borrador. */
function sinSaltos(valor: string): string {
  return valor.replace(/[\r\n]+/g, " ").trim();
}

/** Codifica un encabezado con tildes/ñ/emoji según RFC 2047 (UTF-8, base64),
 * partiendo en varias palabras sin romper caracteres. ASCII pasa intacto. */
export function codificarEncabezado(valor: string): string {
  const texto = sinSaltos(valor);
  if (/^[\x20-\x7E]*$/.test(texto)) return texto;
  const palabras: string[] = [];
  let actual = "";
  for (const caracter of Array.from(texto)) {
    // 45 bytes → 60 caracteres base64, más los 12 de "=?UTF-8?B??=" ≤ 75.
    if (Buffer.byteLength(actual + caracter, "utf-8") > 45) {
      palabras.push(actual);
      actual = "";
    }
    actual += caracter;
  }
  if (actual) palabras.push(actual);
  return palabras.map(p => `=?UTF-8?B?${Buffer.from(p, "utf-8").toString("base64")}?=`).join("\r\n ");
}

function direccionParaEncabezado(nombre: string | null | undefined, email: string): string {
  const correo = sinSaltos(email).replace(/[<>\s]/g, "");
  const limpio = sinSaltos(nombre || "").replace(/["<>\\]/g, "").trim();
  if (!limpio) return correo;
  return /^[\x20-\x7E]*$/.test(limpio) ? `"${limpio}" <${correo}>` : `${codificarEncabezado(limpio)} <${correo}>`;
}

/** Texto plano → HTML seguro (escapa los símbolos y conserva los saltos de línea). */
export function textoAHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/\r\n?/g, "\n").replace(/\n/g, "<br>\n");
}

/** Cuerpo HTML de un borrador: el texto redactado y debajo la firma, en el
 * mismo contenedor que usa Gmail para las firmas (así el buzón la reconoce
 * como firma y no la duplica al abrir el borrador). */
export function componerCuerpoHtml(cuerpoTexto: string, firmaHtml: string): string {
  return `<div dir="ltr">${textoAHtml(cuerpoTexto)}<br><br><div dir="ltr" class="gmail_signature" data-smartmail="gmail_signature">${firmaHtml}</div></div>`;
}

const enBase64DeCorreo = (texto: string) => Buffer.from(texto, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n").trimEnd();

/** Arma el mensaje RFC 822 de una respuesta (UTF-8), listo para guardarse
 * como borrador dentro del mismo hilo. Con `cuerpoHtml` va en los dos
 * formatos (texto plano + HTML, para que la firma conserve su diseño); sin
 * él, solo en texto plano. */
export function construirMimeRespuesta(datos: {
  deEmail: string; deNombre?: string | null;
  paraEmail: string; paraNombre?: string | null;
  asunto: string; cuerpo: string; cuerpoHtml?: string | null;
  inReplyTo?: string | null; references?: string | null;
}): string {
  const encabezados = [
    `From: ${direccionParaEncabezado(datos.deNombre, datos.deEmail)}`,
    `To: ${direccionParaEncabezado(datos.paraNombre, datos.paraEmail)}`,
    `Subject: ${codificarEncabezado(datos.asunto)}`,
  ];
  const inReplyTo = datos.inReplyTo ? sinSaltos(datos.inReplyTo) : "";
  if (inReplyTo) {
    encabezados.push(`In-Reply-To: ${inReplyTo}`);
    const refs = [datos.references ? sinSaltos(datos.references) : "", inReplyTo].filter(Boolean).join(" ");
    encabezados.push(`References: ${refs}`);
  }
  const textoPlano = enBase64DeCorreo(datos.cuerpo.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"));
  if (!datos.cuerpoHtml) {
    encabezados.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
    return `${encabezados.join("\r\n")}\r\n\r\n${textoPlano}\r\n`;
  }
  const limite = "=_areda_borrador_=";
  encabezados.push("MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${limite}"`);
  const parte = (tipo: string, contenido: string) =>
    `--${limite}\r\nContent-Type: ${tipo}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${contenido}\r\n`;
  return `${encabezados.join("\r\n")}\r\n\r\n${parte("text/plain", textoPlano)}${parte("text/html", enBase64DeCorreo(datos.cuerpoHtml))}--${limite}--\r\n`;
}

function aBase64Url(texto: string): string {
  return Buffer.from(texto, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Convierte un mensaje crudo de la API en la forma que usa el agente. */
export function interpretarMensaje(mensaje: gmail_v1.Schema$Message, maxTexto: number): MensajeGmail {
  const encabezados = new Map<string, string>();
  for (const h of mensaje.payload?.headers || []) {
    if (h.name && h.value != null && !encabezados.has(h.name.toLowerCase())) encabezados.set(h.name.toLowerCase(), h.value);
  }
  const de = parsearDireccion(encabezados.get("from"));
  const responder = parsearDireccion(encabezados.get("reply-to"));
  const etiquetas = mensaje.labelIds || [];
  const precedencia = (encabezados.get("precedence") || "").toLowerCase();
  const esMasivo =
    etiquetas.includes("CATEGORY_PROMOTIONS") || etiquetas.includes("CATEGORY_SOCIAL") ||
    encabezados.has("list-unsubscribe") || precedencia === "bulk" || precedencia === "list";
  const fechaMs = Number(mensaje.internalDate);
  return {
    id: mensaje.id || "",
    threadId: mensaje.threadId || mensaje.id || "",
    remitenteNombre: de.nombre,
    remitenteEmail: de.email,
    responderA: responder.email || de.email,
    para: decodificarEncabezado(encabezados.get("to")),
    asunto: decodificarEncabezado(encabezados.get("subject")).trim(),
    fecha: Number.isFinite(fechaMs) && fechaMs > 0 ? new Date(fechaMs) : new Date(),
    snippet: htmlATexto(mensaje.snippet || "").trim(),
    texto: limpiarCuerpo(extraerTexto(mensaje.payload), maxTexto),
    messageIdHeader: encabezados.get("message-id") || null,
    references: encabezados.get("references") || null,
    esMasivo,
    etiquetas,
  };
}

/** Error de Google → mensaje que Arlex entienda y sepa cómo resolver. El
 * detalle técnico queda en el log del servidor. */
export function traducirErrorGmail(error: any, buzon: string): string {
  const data = error?.response?.data;
  const codigo = typeof data?.error === "string" ? data.error : "";
  const descripcion = String(data?.error_description || data?.error?.message || error?.message || "");
  const estado = Number(error?.code || error?.status || error?.response?.status || data?.error?.code || 0);
  let crudo = "";
  try { crudo = JSON.stringify(data || {}); } catch { /* sin detalle */ }
  const todo = `${codigo} ${descripcion} ${crudo}`.toLowerCase();

  if (todo.includes("unauthorized_client")) {
    return "La cuenta de servicio todavía no está autorizada para leer correo en tu Workspace: falta el paso de «Delegación en todo el dominio» en la consola de administrador, o los permisos copiados no coinciden.";
  }
  if (todo.includes("invalid_grant")) {
    return `Google no reconoce el buzón ${buzon}: verifica que esté bien escrito y que sea una cuenta de tu Workspace (no un alias ni un grupo).`;
  }
  if (todo.includes("has not been used in project") || todo.includes("it is disabled") || todo.includes("accessnotconfigured") || todo.includes("service_disabled")) {
    return "La API de Gmail no está activada en el proyecto de Google Cloud de la cuenta de servicio.";
  }
  if (todo.includes("mail service not enabled") || todo.includes("failed_precondition") || todo.includes("failedprecondition")) {
    return `El buzón ${buzon} no tiene Gmail activo (puede ser un grupo o una cuenta sin licencia de correo).`;
  }
  if (estado === 429 || todo.includes("ratelimit") || todo.includes("quota")) {
    return "Google limitó temporalmente las consultas de correo — intenta de nuevo en unos minutos.";
  }
  if (todo.includes("insufficient") && todo.includes("permission")) {
    return "A la autorización del Workspace le falta el permiso de Gmail — copia de nuevo el permiso tal como aparece en los pasos de conexión.";
  }
  return `No se pudo consultar el buzón ${buzon}: ${descripcion.slice(0, 200) || "error desconocido"}`;
}

// ---------------------------------------------------------------------
// Llamadas a Google
// ---------------------------------------------------------------------

export function isGmailConfigured(): boolean {
  return getServiceAccountCredentials() !== null;
}

export type NivelPermiso = "completo" | "basico";

const clientesPorBuzon = new Map<string, gmail_v1.Gmail>();
const autorizadores = new Map<string, InstanceType<typeof google.auth.JWT>>();
/** Qué nivel de permiso tiene cada buzón, con vencimiento: el "basico" se
 * vuelve a comprobar a los pocos minutos, para notar pronto cuando Arlex
 * actualice el permiso en Workspace. */
const nivelPorBuzon = new Map<string, { nivel: NivelPermiso; hasta: number }>();
const MIN = 60 * 1000;

function autorizadorDe(buzon: string, nivel: NivelPermiso) {
  const credenciales = getServiceAccountCredentials();
  if (!credenciales) throw new Error("Falta configurar la cuenta de servicio de Google (las mismas variables de entorno que usa Drive).");
  const clave = `${buzon}|${nivel}`;
  let auth = autorizadores.get(clave);
  if (!auth) {
    auth = new google.auth.JWT({
      email: credenciales.email,
      key: credenciales.privateKey,
      scopes: nivel === "completo" ? GMAIL_SCOPES : GMAIL_SCOPES_ANTERIORES,
      subject: buzon, // el buzón en cuyo nombre actúa la cuenta de servicio
    });
    autorizadores.set(clave, auth);
  }
  return auth;
}

const esNoAutorizado = (error: any) => {
  let crudo = "";
  try { crudo = JSON.stringify(error?.response?.data || {}); } catch { /* sin detalle */ }
  return `${crudo} ${error?.message || ""}`.toLowerCase().includes("unauthorized_client");
};

/** Cliente de Gmail para el buzón, con el mejor permiso que tenga
 * autorizado: primero intenta el permiso nuevo; si Workspace todavía no lo
 * tiene autorizado, cae al anterior (leer + borradores). */
async function resolverCliente(buzon: string): Promise<{ gmail: gmail_v1.Gmail; nivel: NivelPermiso }> {
  const clave = buzon.toLowerCase();
  let estado = nivelPorBuzon.get(clave);
  if (!estado || estado.hasta < Date.now()) {
    try {
      await autorizadorDe(clave, "completo").authorize();
      estado = { nivel: "completo", hasta: Date.now() + 6 * 60 * MIN };
    } catch (error: any) {
      // Cualquier otro fallo (buzón inexistente, API apagada, sin red) no
      // dice nada del permiso: se deja que lo reporte la llamada real.
      if (!esNoAutorizado(error)) throw error;
      estado = { nivel: "basico", hasta: Date.now() + 3 * MIN };
    }
    nivelPorBuzon.set(clave, estado);
  }
  const claveCliente = `${clave}|${estado.nivel}`;
  let gmail = clientesPorBuzon.get(claveCliente);
  if (!gmail) {
    gmail = google.gmail({ version: "v1", auth: autorizadorDe(clave, estado.nivel) });
    clientesPorBuzon.set(claveCliente, gmail);
  }
  return { gmail, nivel: estado.nivel };
}

export const MENSAJE_PERMISO_INSUFICIENTE =
  "Este buzón todavía tiene el permiso anterior, que solo deja leer y redactar. Para mover correos a carpetas y enviar publicidad a la Papelera, actualiza el permiso en Workspace: los pasos están en la pestaña Buzones.";

/** Envuelve una llamada a Gmail: deja el error técnico en el log y lanza
 * uno traducido. Con `requiereCompleto`, la operación (mover, eliminar)
 * solo se intenta si el buzón tiene el permiso nuevo. */
async function conBuzon<T>(
  buzon: string, operacion: string, fn: (gmail: gmail_v1.Gmail, nivel: NivelPermiso) => Promise<T>,
  opciones: { requiereCompleto?: boolean } = {},
): Promise<T> {
  try {
    const { gmail, nivel } = await resolverCliente(buzon);
    if (opciones.requiereCompleto && nivel !== "completo") throw new ErrorGmailDirecto(MENSAJE_PERMISO_INSUFICIENTE, "permiso_insuficiente");
    return await fn(gmail, nivel);
  } catch (error: any) {
    if (error instanceof ErrorGmailDirecto) throw error;
    console.error(`[Gmail] ${operacion} (${buzon}):`, String(error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error).slice(0, 600));
    throw new Error(traducirErrorGmail(error, buzon));
  }
}

/** Comprueba que la cuenta de servicio sí puede entrar a ese buzón. */
export async function probarBuzon(buzon: string): Promise<{ correo: string; totalMensajes: number; permisoCompleto: boolean }> {
  // Se olvida lo que se sabía del permiso: "Probar" es justo lo que Arlex
  // pulsa después de actualizarlo en Workspace.
  nivelPorBuzon.delete(buzon.toLowerCase());
  return conBuzon(buzon, "probar", async (gmail, nivel) => {
    const perfil = await gmail.users.getProfile({ userId: "me" });
    return { correo: perfil.data.emailAddress || buzon, totalMensajes: perfil.data.messagesTotal || 0, permisoCompleto: nivel === "completo" };
  });
}

/** ¿El buzón tiene ya el permiso nuevo (mover y eliminar)? */
export async function tienePermisoCompleto(buzon: string): Promise<boolean> {
  return conBuzon(buzon, "consultar permiso", async (_gmail, nivel) => nivel === "completo");
}

export type CarpetaGmail = { id: string; nombre: string };

/** Las carpetas (etiquetas) que el dueño del buzón ha creado en Gmail,
 * ordenadas por nombre. No incluye las del sistema (Recibidos, Enviados…). */
export async function listarCarpetas(buzon: string): Promise<CarpetaGmail[]> {
  return conBuzon(buzon, "listar carpetas", async (gmail) => {
    const respuesta = await gmail.users.labels.list({ userId: "me" });
    return (respuesta.data.labels || [])
      .filter(l => l.type === "user" && l.id && l.name)
      .map(l => ({ id: l.id!, nombre: l.name! }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  });
}

/** Mueve la conversación completa a una carpeta: le pone la etiqueta y la
 * saca de Recibidos (lo mismo que "Mover a" en Gmail). No borra nada. */
export async function moverHiloACarpeta(buzon: string, threadId: string, carpetaId: string): Promise<void> {
  await conBuzon(buzon, "mover a carpeta", async (gmail) => {
    try {
      await gmail.users.threads.modify({ userId: "me", id: threadId, requestBody: { addLabelIds: [carpetaId], removeLabelIds: ["INBOX"] } });
    } catch (error: any) {
      const detalle = `${error?.message || ""} ${JSON.stringify(error?.response?.data || {})}`.toLowerCase();
      if (detalle.includes("label") && (detalle.includes("invalid") || detalle.includes("not found"))) {
        throw new ErrorGmailDirecto("Esa carpeta ya no existe en Gmail (pudo haberse borrado o renombrado). Elige otra.", "carpeta_inexistente");
      }
      throw error;
    }
  }, { requiereCompleto: true });
}

/** Envía un mensaje a la Papelera de Gmail (recuperable durante 30 días).
 * Si el mensaje ya no existe, se da por hecho. */
export async function enviarAPapelera(buzon: string, id: string): Promise<void> {
  await conBuzon(buzon, "enviar a la papelera", async (gmail) => {
    try {
      await gmail.users.messages.trash({ userId: "me", id });
    } catch (error: any) {
      if (Number(error?.code || error?.response?.status || 0) !== 404) throw error;
    }
  }, { requiereCompleto: true });
}

/** La firma que el buzón tiene configurada en Gmail como predeterminada
 * (en HTML), o null si no tiene. Google solo expone esa — una firma
 * adicional que no sea la predeterminada no se puede leer por nombre. Un
 * fallo aquí nunca impide redactar: se devuelve null y se sigue. */
export async function obtenerFirmaGmail(buzon: string): Promise<string | null> {
  try {
    return await conBuzon(buzon, "leer firma", async (gmail) => {
      const respuesta = await gmail.users.settings.sendAs.list({ userId: "me" });
      const identidades = respuesta.data.sendAs || [];
      const propia = identidades.find(i => i.sendAsEmail?.toLowerCase() === buzon.toLowerCase()) || identidades.find(i => i.isPrimary) || identidades.find(i => i.isDefault);
      const firma = propia?.signature?.trim();
      return firma ? firma : null;
    });
  } catch {
    return null;
  }
}

/** IDs de los correos de la bandeja de entrada de los últimos `dias` días,
 * del más reciente al más antiguo (hasta `max`). */
export async function listarIdsBandeja(buzon: string, dias: number, max: number): Promise<string[]> {
  return conBuzon(buzon, "listar", async (gmail) => {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const respuesta = await gmail.users.messages.list({
        userId: "me",
        q: `in:inbox newer_than:${Math.max(1, Math.round(dias))}d`,
        maxResults: Math.min(100, max - ids.length),
        pageToken,
      });
      for (const m of respuesta.data.messages || []) if (m.id) ids.push(m.id);
      pageToken = respuesta.data.nextPageToken || undefined;
    } while (pageToken && ids.length < max);
    return ids;
  });
}

export async function obtenerMensaje(buzon: string, id: string, maxTexto = 1500): Promise<MensajeGmail> {
  return conBuzon(buzon, "leer mensaje", async (gmail) => {
    const respuesta = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    return interpretarMensaje(respuesta.data, maxTexto);
  });
}

/** Los mensajes de una conversación, del más antiguo al más reciente. */
export async function obtenerHilo(buzon: string, threadId: string, maxTextoPorMensaje = 3000): Promise<MensajeGmail[]> {
  return conBuzon(buzon, "leer conversación", async (gmail) => {
    const respuesta = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
    return (respuesta.data.messages || []).map(m => interpretarMensaje(m, maxTextoPorMensaje));
  });
}

/** Guarda una respuesta como BORRADOR dentro del hilo — nunca la envía. Si
 * ya había un borrador de este agente para el correo, lo reemplaza (y si
 * alguien lo borró o lo envió desde Gmail, crea uno nuevo). */
export async function guardarBorradorRespuesta(buzon: string, datos: {
  threadId: string; deNombre?: string | null;
  paraEmail: string; paraNombre?: string | null;
  asunto: string; cuerpo: string; cuerpoHtml?: string | null;
  inReplyTo?: string | null; references?: string | null;
  borradorIdExistente?: string | null;
}): Promise<{ borradorId: string }> {
  const raw = aBase64Url(construirMimeRespuesta({
    deEmail: buzon, deNombre: datos.deNombre,
    paraEmail: datos.paraEmail, paraNombre: datos.paraNombre,
    asunto: datos.asunto, cuerpo: datos.cuerpo, cuerpoHtml: datos.cuerpoHtml,
    inReplyTo: datos.inReplyTo, references: datos.references,
  }));
  const requestBody = { message: { raw, threadId: datos.threadId } };
  return conBuzon(buzon, "guardar borrador", async (gmail) => {
    if (datos.borradorIdExistente) {
      try {
        const actualizado = await gmail.users.drafts.update({ userId: "me", id: datos.borradorIdExistente, requestBody });
        return { borradorId: actualizado.data.id || datos.borradorIdExistente };
      } catch (error: any) {
        const estado = Number(error?.code || error?.response?.status || 0);
        if (estado !== 404) throw error;
        // El borrador anterior ya no existe en Gmail → se crea uno nuevo.
      }
    }
    const creado = await gmail.users.drafts.create({ userId: "me", requestBody });
    if (!creado.data.id) throw new Error("Gmail no devolvió el identificador del borrador.");
    return { borradorId: creado.data.id };
  });
}

let clientIdEnCache: string | null = null;

/** Datos de la cuenta de servicio que Arlex necesita para el paso de
 * autorización en la consola de Workspace. El ID de cliente (número) no
 * está en las variables de entorno: se le pregunta a Google a quién
 * pertenece un token de la cuenta de servicio. Si esa consulta falla,
 * `clientId` queda null y la pantalla explica dónde encontrarlo a mano. */
export async function obtenerDatosCuentaServicio(): Promise<{
  configurado: boolean; correo: string | null; proyecto: string | null; clientId: string | null; permisos: string[];
}> {
  const credenciales = getServiceAccountCredentials();
  if (!credenciales) return { configurado: false, correo: null, proyecto: null, clientId: null, permisos: GMAIL_SCOPES };
  const proyecto = credenciales.email.match(/@([^.]+)\.iam\.gserviceaccount\.com$/)?.[1] || null;
  if (!clientIdEnCache) {
    try {
      const auth = new google.auth.JWT({
        email: credenciales.email, key: credenciales.privateKey,
        scopes: ["https://www.googleapis.com/auth/drive"],
      });
      const { access_token } = await auth.authorize();
      if (access_token) {
        const respuesta = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(access_token)}`);
        if (respuesta.ok) {
          const info = (await respuesta.json()) as { azp?: string; aud?: string };
          const candidato = info.azp || info.aud || "";
          if (/^\d{10,}$/.test(candidato)) clientIdEnCache = candidato;
        }
      }
    } catch (error: any) {
      console.error("[Gmail] No se pudo obtener el ID de cliente de la cuenta de servicio:", String(error?.message || error).slice(0, 300));
    }
  }
  return { configurado: true, correo: credenciales.email, proyecto, clientId: clientIdEnCache, permisos: GMAIL_SCOPES };
}

/** Ejecuta `fn` sobre `items` con un máximo de `limite` a la vez — para no
 * disparar decenas de consultas simultáneas contra Gmail. */
export async function enParalelo<T, R>(items: T[], limite: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const indice = siguiente++;
      resultados[indice] = await fn(items[indice]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return resultados;
}
