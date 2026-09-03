// Thin LLM client backed directly by the Anthropic API.
// Keeps the original OpenAI-style call shape (messages / image_url / file_url /
// output schema) used throughout the app, so callers didn't need to change.

import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = { type: "text"; text: string };
export type ImageContent = {
  type: "image_url";
  image_url: { url: string; detail?: "auto" | "low" | "high" };
};
export type FileContent = {
  type: "file_url";
  file_url: { url: string; mime_type?: string };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type JsonSchema = { name: string; schema: Record<string, unknown>; strict?: boolean };
export type OutputSchema = JsonSchema;
export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

export type InvokeParams = {
  messages: Message[];
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: Role; content: string };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

const DEFAULT_MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

const ensureArray = (v: MessageContent | MessageContent[]): MessageContent[] =>
  Array.isArray(v) ? v : [v];

const assertApiKey = () => {
  if (!ENV.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
};

// Anthropic needs raw base64 bytes for images/documents, not remote URLs, so
// we fetch the (signed) URL server-side and inline it.
async function fetchAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) {
    const bodyText = await resp.text().catch(() => "(no se pudo leer el cuerpo)");
    console.error(
      `[fetchAsBase64] ${resp.status} ${resp.statusText} al pedir la URL firmada.\n` +
        `URL (recortada): ${url.split("?")[0]}\n` +
        `Respuesta del servidor de almacenamiento: ${bodyText.slice(0, 500)}`
    );
    throw new Error(`No se pudo descargar el archivo para la IA (${resp.status})`);
  }
  const mediaType = resp.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const arrayBuffer = await resp.arrayBuffer();
  const data = Buffer.from(arrayBuffer).toString("base64");
  return { data, mediaType };
}

async function normalizeContentPart(part: MessageContent): Promise<Record<string, unknown>> {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return { type: "text", text: part.text };
  }

  if (part.type === "image_url") {
    const { data, mediaType } = await fetchAsBase64(part.image_url.url);
    return {
      type: "image",
      source: { type: "base64", media_type: mediaType || "image/jpeg", data },
    };
  }

  if (part.type === "file_url") {
    const { data, mediaType } = await fetchAsBase64(part.file_url.url);
    return {
      type: "document",
      source: {
        type: "base64",
        media_type: part.file_url.mime_type || mediaType || "application/pdf",
        data,
      },
    };
  }

  throw new Error("Unsupported message content part");
}

async function normalizeMessage(message: Message) {
  const parts = ensureArray(message.content);
  const content = await Promise.all(parts.map(normalizeContentPart));
  return { role: message.role === "assistant" ? "assistant" : "user", content };
}

function extractJsonInstruction(params: InvokeParams): string {
  const schema =
    params.outputSchema || params.output_schema ||
    (params.responseFormat?.type === "json_schema" ? params.responseFormat.json_schema : undefined) ||
    (params.response_format?.type === "json_schema" ? params.response_format.json_schema : undefined);

  if (!schema) return "";
  return `\n\nResponde ÚNICAMENTE con un JSON válido que siga este esquema (sin texto adicional, sin markdown): ${JSON.stringify(schema.schema)}`;
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();

  const systemMessages = params.messages.filter(m => m.role === "system");
  const otherMessages = params.messages.filter(m => m.role !== "system");

  const systemText = systemMessages
    .map(m => (typeof m.content === "string" ? m.content : ensureArray(m.content)
      .filter((p): p is TextContent => typeof p !== "string" && p.type === "text")
      .map(p => p.text)
      .join("\n")))
    .join("\n") + extractJsonInstruction(params);

  const anthropicMessages = await Promise.all(otherMessages.map(normalizeMessage));

  const body: Record<string, unknown> = {
    model: params.model || DEFAULT_MODEL,
    max_tokens: params.max_tokens ?? params.maxTokens ?? 4096,
    messages: anthropicMessages,
  };
  if (systemText.trim()) {
    body.system = systemText;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ENV.anthropicApiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    // El texto crudo de la API (JSON técnico en inglés) queda en el log del
    // servidor para diagnóstico, pero el usuario del portal necesita un
    // mensaje que entienda y sepa qué hacer — sobre todo el de créditos
    // agotados, que sin esto se veía como un JSON críptico tanto en el
    // asistente IA como al subir un libro auxiliar (ambos usan invokeLLM).
    console.error(`LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`);
    let mensaje = "No se pudo completar la solicitud de IA. Intenta de nuevo en unos minutos.";
    if (errorText.includes("credit balance is too low")) {
      mensaje = "Los créditos de la cuenta de IA se agotaron — por favor consulta con tu administrador para recargarlos.";
    } else if (response.status === 429) {
      mensaje = "El servicio de IA está temporalmente saturado — intenta de nuevo en unos minutos.";
    } else if (response.status >= 500) {
      mensaje = "El servicio de IA no está disponible en este momento — intenta de nuevo en unos minutos.";
    }
    throw new Error(mensaje);
  }

  const data = (await response.json()) as {
    id: string;
    model: string;
    content: Array<{ type: string; text?: string }>;
    stop_reason: string | null;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const text = data.content
    .filter(block => block.type === "text")
    .map(block => block.text || "")
    .join("");

  return {
    id: data.id,
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: data.stop_reason,
      },
    ],
    usage: data.usage
      ? {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        }
      : undefined,
  };
}
