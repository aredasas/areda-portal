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
 * Permisos: leer correo + gestionar borradores. Google no ofrece un
 * permiso de "solo borradores" — gmail.compose también permitiría enviar,
 * pero este módulo NO tiene ninguna función que envíe: solo deja el
 * borrador en el buzón para que una persona lo revise y lo envíe. */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
];

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

/** Arma el mensaje RFC 822 de una respuesta en texto plano (UTF-8), listo
 * para guardarse como borrador dentro del mismo hilo. */
export function construirMimeRespuesta(datos: {
  deEmail: string; deNombre?: string | null;
  paraEmail: string; paraNombre?: string | null;
  asunto: string; cuerpo: string;
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
  encabezados.push("MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64");
  const cuerpoBase64 = Buffer.from(datos.cuerpo.replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n"), "utf-8")
    .toString("base64").replace(/(.{76})/g, "$1\r\n").trimEnd();
  return `${encabezados.join("\r\n")}\r\n\r\n${cuerpoBase64}\r\n`;
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
    return "A la autorización del Workspace le falta alguno de los dos permisos de Gmail — copia de nuevo los permisos tal como aparecen en los pasos de conexión.";
  }
  return `No se pudo consultar el buzón ${buzon}: ${descripcion.slice(0, 200) || "error desconocido"}`;
}

// ---------------------------------------------------------------------
// Llamadas a Google
// ---------------------------------------------------------------------

export function isGmailConfigured(): boolean {
  return getServiceAccountCredentials() !== null;
}

const clientesPorBuzon = new Map<string, gmail_v1.Gmail>();

function getGmailClient(buzon: string): gmail_v1.Gmail {
  const credenciales = getServiceAccountCredentials();
  if (!credenciales) throw new Error("Falta configurar la cuenta de servicio de Google (las mismas variables de entorno que usa Drive).");
  const clave = buzon.toLowerCase();
  let cliente = clientesPorBuzon.get(clave);
  if (!cliente) {
    const auth = new google.auth.JWT({
      email: credenciales.email,
      key: credenciales.privateKey,
      scopes: GMAIL_SCOPES,
      subject: clave, // el buzón en cuyo nombre actúa la cuenta de servicio
    });
    cliente = google.gmail({ version: "v1", auth });
    clientesPorBuzon.set(clave, cliente);
  }
  return cliente;
}

/** Envuelve una llamada a Gmail: deja el error técnico en el log y lanza
 * uno traducido. */
async function conBuzon<T>(buzon: string, operacion: string, fn: (gmail: gmail_v1.Gmail) => Promise<T>): Promise<T> {
  try {
    return await fn(getGmailClient(buzon));
  } catch (error: any) {
    console.error(`[Gmail] ${operacion} (${buzon}):`, String(error?.response?.data ? JSON.stringify(error.response.data) : error?.message || error).slice(0, 600));
    throw new Error(traducirErrorGmail(error, buzon));
  }
}

/** Comprueba que la cuenta de servicio sí puede entrar a ese buzón. */
export async function probarBuzon(buzon: string): Promise<{ correo: string; totalMensajes: number }> {
  return conBuzon(buzon, "probar", async (gmail) => {
    const perfil = await gmail.users.getProfile({ userId: "me" });
    return { correo: perfil.data.emailAddress || buzon, totalMensajes: perfil.data.messagesTotal || 0 };
  });
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
  asunto: string; cuerpo: string;
  inReplyTo?: string | null; references?: string | null;
  borradorIdExistente?: string | null;
}): Promise<{ borradorId: string }> {
  const raw = aBase64Url(construirMimeRespuesta({
    deEmail: buzon, deNombre: datos.deNombre,
    paraEmail: datos.paraEmail, paraNombre: datos.paraNombre,
    asunto: datos.asunto, cuerpo: datos.cuerpo,
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
