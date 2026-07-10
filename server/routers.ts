import { COOKIE_NAME } from "@shared/const";
import crypto from "crypto";

// Attendance/hours data ("Asistencia") is restricted to this one specific
// admin by explicit business request — not all admins should see it.
const ASISTENCIA_AUTHORIZED_CEDULA = "5820262";

/** Best-effort copy of evidence files into the client's Drive folder.
 * R2 remains the source of truth for the app itself (viewing/downloading
 * evidence always works even if this fails) — this just also places a copy
 * where the firm already expects to find client documents. Never throws:
 * callers fire this without awaiting, so a Drive hiccup never blocks
 * completing a task or deadline. */
async function pushEvidenceToDrive(
  clientId: number,
  subfolderName: string | undefined,
  files: { url: string; key?: string; fileName: string; contentType?: string }[],
  subfolderId?: string
) {
  if (!isDriveConfigured()) {
    console.warn("[Google Drive] Saltado: las variables de entorno no están configuradas.");
    return;
  }
  const client = await db.getClientById(clientId);
  if (!client?.driveFolderUrl) {
    console.warn(`[Google Drive] Saltado: el cliente ${clientId} no tiene driveFolderUrl configurado.`);
    return;
  }
  const rootFolderId = extractFolderIdFromUrl(client.driveFolderUrl);
  if (!rootFolderId) {
    console.warn(`[Google Drive] Saltado: no se pudo extraer el ID de carpeta de la URL "${client.driveFolderUrl}".`);
    return;
  }

  console.log(`[Google Drive] Subiendo ${files.length} archivo(s) para el cliente ${clientId}, carpeta raíz ${rootFolderId}, subcarpeta "${subfolderName || subfolderId || "(ninguna)"}"`);
  // If the person picked an existing (possibly nested) folder from the real
  // Drive listing, we already have its exact id — no need to search/create.
  const targetFolderId = subfolderId || await resolveUploadFolder(rootFolderId, subfolderName);
  console.log(`[Google Drive] Carpeta destino resuelta: ${targetFolderId}`);

  for (const file of files) {
    // file.url is a relative "/files/..." path meant for the browser, not a
    // fetchable server-to-server URL — get a real signed R2 URL from the
    // storage key instead (falling back to stripping the "/files/" prefix
    // if the key wasn't passed through for some reason).
    const storageKey = file.key || file.url.replace(/^\/files\//, "");
    const signedUrl = await storageGetSignedUrl(storageKey);
    const response = await fetch(signedUrl);
    if (!response.ok) {
      console.error(`[Google Drive] No se pudo descargar ${file.fileName} desde R2 (${response.status})`);
      continue;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const uploaded = await uploadFileToDrive(targetFolderId, file.fileName, buffer, file.contentType || "application/octet-stream");
    console.log(`[Google Drive] Subido correctamente: ${file.fileName} -> ${uploaded.webViewLink}`);
  }
}

import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { storagePut, storageGetSignedUrl } from "./storage";
import { invokeLLM } from "./_core/llm";
import { isDriveConfigured, extractFolderIdFromUrl, testFolderAccess, listSubfoldersRecursive, listAllFilesRecursive, uploadFileToDrive, resolveUploadFolder } from "./googleDrive";
import { sdk } from "./_core/sdk";
import { ONE_YEAR_MS } from "@shared/const";
import bcrypt from "bcryptjs";

// In-memory job store for the DIAN calendar PDF extraction. Reading a full
// calendar can take several minutes (one AI call per obligation, spaced out
// to respect the API rate limit) — far too long for a single HTTP request to
// survive proxies/load balancers. Instead, the request that starts the job
// returns immediately with a jobId, and the client polls for progress.
// Job data only needs to live for the few minutes the admin is waiting on
// this screen, so in-memory (lost on restart) is an acceptable tradeoff here.
type DianExtractionJob = {
  status: "processing" | "completed" | "failed";
  progress: { current: number; total: number; currentObligation: string };
  result?: { entries: any[]; failedObligations: string[]; partialObligations: string[]; error: string | null };
  error?: string;
  startedAt: number;
};

const dianExtractionJobs = new Map<string, DianExtractionJob>();

// Jobs older than this are dropped on next access so the map doesn't grow
// unbounded if an admin never comes back to check on one.
const JOB_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes

function pruneOldExtractionJobs() {
  const now = Date.now();
  for (const [id, job] of dianExtractionJobs.entries()) {
    if (now - job.startedAt > JOB_MAX_AGE_MS) dianExtractionJobs.delete(id);
  }
}

async function runDianExtractionJob(jobId: string, fileKey: string, year: number) {
  const job = dianExtractionJobs.get(jobId);
  if (!job) return;

  try {
    const accessUrl = await storageGetSignedUrl(fileKey);
    const activeObligations = await db.getAllTaxObligations();
    job.progress.total = activeObligations.length;

    const allEntries: any[] = [];
    const failedObligations: string[] = [];
    const partialObligations: string[] = [];

    for (let i = 0; i < activeObligations.length; i++) {
      const obl = activeObligations[i];
      job.progress.current = i + 1;
      job.progress.currentObligation = `${obl.code} (${obl.name})`;

      const cuotasNote = obl.frequency === "anual" && obl.installments > 1 ? `, pagada en ${obl.installments} cuotas` : "";

      const periodFormatHint = (() => {
        switch (obl.frequency) {
          case "mensual":
            return `Mensual: un registro por cada mes ("${year}-01" a "${year}-12"), para cada dígito o rango de NIT que encuentre.`;
          case "bimestral":
            return `Bimestral: períodos "${year}-01-02", "${year}-03-04", "${year}-05-06", "${year}-07-08", "${year}-09-10", "${year}-11-12".`;
          case "cuatrimestral":
            return `Cuatrimestral: períodos "${year}-01-04", "${year}-05-08", "${year}-09-12".`;
          case "semestral":
            return `Semestral: períodos "${year}-01-06", "${year}-07-12".`;
          case "anual":
            return obl.installments > 1
              ? `Anual con cuotas: use "${year}-cuota1", "${year}-cuota2"${obl.installments > 2 ? `, "${year}-cuota3"` : ""}, en el mismo orden en que aparecen las cuotas en el calendario (la primera cuota del año es cuota1, y así sucesivamente).`
              : `Anual sin cuotas: un solo período, "${year}".`;
          default:
            return `Use "${year}" como período.`;
        }
      })();

      let entries: any[] = [];
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        let jsonStr = "";
        try {
          const response = await invokeLLM({
            max_tokens: 8000,
            messages: [
              {
                role: "system",
                content: `Eres un asistente experto en el calendario tributario de la DIAN (Colombia). Vas a recibir el PDF oficial del calendario tributario del año ${year}. Tu ÚNICA tarea es extraer las fechas de vencimiento de UNA sola obligación: "${obl.code}" (${obl.name}${cuotasNote}). Ignora completamente cualquier otra tabla u obligación del documento, aunque aparezcan cerca.

Formato de agrupación por NIT — identifica cuál usa esta obligación específica en el documento:
1. Un solo dígito del NIT (0 al 9): "lastDigitNit": "0" a "9", un registro por dígito.
2. Últimos DOS dígitos del NIT en pares (ej. "01-02", "03-04"... "99-00"): "lastDigitNit": "01-02" (con guion, ambos dígitos con cero a la izquierda), un registro por cada par.
3. Fecha única sin importar el NIT (tabla que diga "independientemente del número de identificación tributaria"): "lastDigitNit": "ALL", un solo registro.

Formato del campo "period" para esta obligación: ${periodFormatHint}

Nota: si una fecha cae en enero o febrero del año siguiente (ej. "Enero ${year + 1}"), regístrala igual bajo el año ${year}, ya que corresponde a ese período fiscal.

Si NO encuentras la obligación "${obl.code}" en el documento, devuelve { "entries": [] }. NUNCA respondas con una explicación en texto — ni siquiera si no encuentras la obligación, tu respuesta completa debe ser solo el JSON.

Devuelve ÚNICAMENTE un JSON con esta forma exacta, sin explicaciones ni markdown:
{ "entries": [ { "obligationCode": "${obl.code}", "period": "...", "lastDigitNit": "...", "dueDate": "YYYY-MM-DD" } ] }`
              },
              {
                role: "user",
                content: [
                  { type: "text" as const, text: `Extrae únicamente las fechas de "${obl.name}" (${obl.code}) del calendario tributario DIAN ${year}:` },
                  { type: "file_url" as const, file_url: { url: accessUrl, mime_type: "application/pdf" } },
                ],
              },
            ],
          });

          const rawContent = response.choices?.[0]?.message?.content || "";
          const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
          jsonStr = content;
          if (content.includes("```")) {
            const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
            jsonStr = match ? match[1].trim() : content;
          }

          const parsed = JSON.parse(jsonStr);
          entries = Array.isArray(parsed.entries) ? parsed.entries : [];
          lastError = null;
          break;
        } catch (error) {
          const salvaged = rescueEntriesFromTruncatedJson(jsonStr);
          if (salvaged.length > 0) {
            entries = salvaged;
            lastError = null;
            partialObligations.push(obl.code);
            console.warn(`[DIAN Calendar Extraction] ${obl.code}: respuesta cortada, se rescataron ${salvaged.length} registros parciales.`);
            break;
          }

          const lowerJson = jsonStr.toLowerCase();
          const looksLikeNotFound = /no\s+(encontr|encuentr|aparece|est(a|á)\s+presente|se menciona|hay informaci)/i.test(lowerJson);
          if (looksLikeNotFound) {
            entries = [];
            lastError = null;
            console.warn(`[DIAN Calendar Extraction] ${obl.code}: la IA indicó que no encontró esta obligación en el documento.`);
            break;
          }

          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          const isRateLimit = message.includes("429") || message.includes("rate_limit");
          if (isRateLimit && attempt < 3) {
            console.warn(`[DIAN Calendar Extraction] Rate limited on ${obl.code}, esperando antes de reintentar (intento ${attempt})...`);
            await sleep(25000 * attempt);
            continue;
          }
          break;
        }
      }

      if (lastError) {
        console.error(`[DIAN Calendar Extraction] Failed for ${obl.code}:`, lastError);
        failedObligations.push(obl.code);
      } else {
        allEntries.push(...entries);
      }

      if (i < activeObligations.length - 1) {
        await sleep(16000);
      }
    }

    job.status = "completed";
    job.result = {
      entries: allEntries,
      failedObligations,
      partialObligations,
      error: allEntries.length === 0
        ? "No se pudo extraer ninguna fecha del PDF. Revise el archivo o intente con el formato CSV."
        : null,
    };
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : "Error inesperado procesando el PDF";
    console.error("[DIAN Calendar Extraction] Job failed:", error);
  }
}

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      if (ctx.user?.id) {
        await db.cleanupOldReadNotifications(ctx.user.id);
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    /** Local login with username (cédula or custom) + password */
    localLogin: publicProcedure
      .input(z.object({ username: z.string().min(1), password: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserByUsername(input.username);
        if (!user || !user.passwordHash) {
          throw new Error("Usuario o contraseña incorrectos");
        }
        if (!user.isActive) {
          throw new Error("Esta cuenta ha sido desactivada. Contacte al administrador.");
        }
        const valid = await bcrypt.compare(input.password, user.passwordHash);
        if (!valid) {
          throw new Error("Usuario o contraseña incorrectos");
        }
        // Create session
        const sessionToken = await sdk.createSessionToken(user.openId, {
          name: user.name || "",
          expiresInMs: ONE_YEAR_MS,
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
        // Update last signed in
        await db.updateUser(user.id, { lastSignedIn: new Date() });
        return { success: true, user: { id: user.id, name: user.name, role: user.role } };
      }),
    /** Change password (user can change their own) */
    changePassword: protectedProcedure
      .input(z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(6) }))
      .mutation(async ({ input, ctx }) => {
        const user = await db.getUserById(ctx.user.id);
        if (!user || !user.passwordHash) throw new Error("No se puede cambiar la contraseña");
        const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
        if (!valid) throw new Error("Contraseña actual incorrecta");
        const hash = await bcrypt.hash(input.newPassword, 10);
        await db.updateUserPassword(user.id, hash);
        return { success: true };
      }),
  }),

  collaborators: router({
    list: protectedProcedure
      .input(z.object({ role: z.string().optional(), isActive: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        return db.getUsersByFilters(input || {});
      }),
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        email: z.string().optional(),
        username: z.string().min(3),
        password: z.string().min(6),
        cedula: z.string().optional(),
        role: z.enum(["admin", "contador_senior", "contador_junior", "asistente"]),
        phone: z.string().optional(),
        position: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Check username uniqueness
        const existing = await db.getUserByUsername(input.username);
        if (existing) throw new Error("El nombre de usuario ya está en uso");
        const passwordHash = await bcrypt.hash(input.password, 10);
        const id = await db.createCollaborator({
          name: input.name,
          email: input.email,
          username: input.username,
          passwordHash,
          cedula: input.cedula,
          role: input.role,
          phone: input.phone,
          position: input.position,
        });
        return { id };
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        email: z.string().optional(),
        username: z.string().min(3).optional(),
        cedula: z.string().optional(),
        role: z.enum(["admin", "contador_senior", "contador_junior", "asistente"]).optional(),
        phone: z.string().optional(),
        position: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        if (data.username) {
          const existing = await db.getUserByUsername(data.username);
          if (existing && existing.id !== id) throw new Error("El nombre de usuario ya está en uso");
        }
        await db.updateUser(id, data as any);
        return { success: true };
      }),
    resetPassword: adminProcedure
      .input(z.object({ id: z.number(), newPassword: z.string().min(6) }))
      .mutation(async ({ input }) => {
        const hash = await bcrypt.hash(input.newPassword, 10);
        await db.updateUserPassword(input.id, hash);
        return { success: true };
      }),
    deactivate: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deactivateUser(input.id);
        return { success: true };
      }),
    activate: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.activateUser(input.id);
        return { success: true };
      }),
    getActive: protectedProcedure.query(async () => {
      return db.getActiveUsers();
    }),
  }),

  clients: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getAllClients(ctx.user.role === "admin" ? undefined : ctx.user.id);
    }),
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input, ctx }) => {
        const client = await db.getClientById(input.id);
        if (client && ctx.user.role !== "admin" && client.managerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a este cliente" });
        }
        return client;
      }),
    /** Subfolder names previously used inside this client's Drive folder,
     * offered as a dropdown when uploading evidence so people reuse the
     * exact same name instead of retyping a slightly different one. */
    getDriveSubfolders: protectedProcedure
      .input(z.object({ clientId: z.number() }))
      .query(async ({ input }) => {
        return db.getClientDriveSubfolders(input.clientId);
      }),
    create: adminProcedure
      .input(z.object({
        razonSocial: z.string().min(1),
        nit: z.string().min(1),
        digitoVerificacion: z.string().optional(),
        direccion: z.string().optional(),
        ciudad: z.string().optional(),
        departamento: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        actividadEconomica: z.string().optional(),
        codigoCIIU: z.string().optional(),
        representanteLegal: z.string().optional(),
        rutFileUrl: z.string().optional(),
        rutFileKey: z.string().optional(),
        managerId: z.number().optional(),
        driveFolderUrl: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await db.createClient({ ...input, createdById: ctx.user.id });
        return { id };
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        razonSocial: z.string().optional(),
        nit: z.string().optional(),
        digitoVerificacion: z.string().optional(),
        direccion: z.string().optional(),
        ciudad: z.string().optional(),
        departamento: z.string().optional(),
        telefono: z.string().optional(),
        email: z.string().optional(),
        actividadEconomica: z.string().optional(),
        codigoCIIU: z.string().optional(),
        representanteLegal: z.string().optional(),
        rutFileUrl: z.string().optional(),
        rutFileKey: z.string().optional(),
        managerId: z.number().nullable().optional(),
        driveFolderUrl: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateClient(id, data);
        return { success: true };
      }),
    deactivate: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deactivateClient(input.id);
        return { success: true };
      }),
    uploadRut: protectedProcedure
      .input(z.object({
        fileName: z.string(),
        fileBase64: z.string(),
        contentType: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const rawKey = `rut/${Date.now()}_${input.fileName}`;
        const { url, key } = await storagePut(rawKey, buffer, input.contentType);
        return { url, key };
      }),
    extractRutData: protectedProcedure
      .input(z.object({ fileUrl: z.string(), fileKey: z.string().optional(), contentType: z.string().optional() }))
      .mutation(async ({ input }) => {
        try {
          // Get a signed URL that the LLM can actually access
          let accessUrl: string;
          if (input.fileKey) {
            accessUrl = await storageGetSignedUrl(input.fileKey);
          } else if (input.fileUrl.startsWith("http")) {
            accessUrl = input.fileUrl;
          } else {
            // Try to get signed URL from the key in the path
            const key = input.fileUrl.replace(/^\/files\//, "");
            accessUrl = await storageGetSignedUrl(key);
          }
          
          const isPdf = input.contentType?.includes("pdf") || input.fileUrl.endsWith(".pdf") || input.fileKey?.endsWith(".pdf");
          
          // Build the content part based on file type
          const fileContent: any = isPdf
            ? { type: "file_url", file_url: { url: accessUrl, mime_type: "application/pdf" } }
            : { type: "image_url", image_url: { url: accessUrl, detail: "high" } };

          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `Eres un asistente experto en documentos tributarios colombianos. Tu tarea es extraer datos del RUT (Registro Único Tributario) de Colombia. Debes devolver ÚNICAMENTE un JSON válido con los siguientes campos (sin explicaciones adicionales):
{
  "razonSocial": "nombre o razón social del contribuyente",
  "nit": "número de identificación tributaria sin dígito de verificación",
  "digitoVerificacion": "dígito de verificación (un solo dígito)",
  "direccion": "dirección completa",
  "ciudad": "ciudad",
  "departamento": "departamento",
  "actividadEconomica": "descripción de la actividad económica principal",
  "codigoCIIU": "código CIIU de la actividad económica",
  "representanteLegal": "nombre del representante legal si aplica",
  "email": "correo electrónico si aparece",
  "telefono": "teléfono si aparece"
}
Si no puedes leer algún campo, déjalo como cadena vacía "". Responde SOLO con el JSON, sin markdown ni texto adicional.`
              },
              {
                role: "user",
                content: [
                  {
                    type: "text" as const,
                    text: "Extrae los datos del siguiente documento RUT colombiano:"
                  },
                  fileContent
                ]
              }
            ],
          });

          const rawContent = response.choices?.[0]?.message?.content || "";
          const content = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
          // Parse JSON from response, handling possible markdown code blocks
          let jsonStr = content;
          if (content.includes("```")) {
            const match = content.match(/```(?:json)?\s*([\s\S]*?)```/);
            jsonStr = match ? match[1].trim() : content;
          }
          
          const parsed = JSON.parse(jsonStr);
          return {
            razonSocial: parsed.razonSocial || "",
            nit: parsed.nit || "",
            digitoVerificacion: parsed.digitoVerificacion || "",
            direccion: parsed.direccion || "",
            ciudad: parsed.ciudad || "",
            departamento: parsed.departamento || "",
            actividadEconomica: parsed.actividadEconomica || "",
            codigoCIIU: parsed.codigoCIIU || "",
            representanteLegal: parsed.representanteLegal || "",
            email: parsed.email || "",
            telefono: parsed.telefono || "",
            error: null,
          };
        } catch (error) {
          console.error("[RUT Extraction] Failed:", error);
          return {
            razonSocial: "", nit: "", digitoVerificacion: "", direccion: "",
            ciudad: "", departamento: "", actividadEconomica: "", codigoCIIU: "",
            representanteLegal: "", email: "", telefono: "",
            error: "No se pudo extraer los datos del RUT. Verifique que el archivo sea legible.",
          };
        }
      }),
  }),

  obligations: router({
    list: protectedProcedure.query(async () => {
      return db.getAllTaxObligations();
    }),
    listAll: adminProcedure.query(async () => {
      return db.getAllTaxObligationsForAdmin();
    }),
    create: adminProcedure
      .input(z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        frequency: z.enum(["mensual", "bimestral", "cuatrimestral", "semestral", "anual"]),
        installments: z.number().min(1).max(12).optional(),
        fixedDueDates: z.array(z.string().regex(/^\d{2}-\d{2}$/, "Formato debe ser MM-DD")).optional(),
      }))
      .mutation(async ({ input }) => {
        const { fixedDueDates, ...rest } = input;
        const id = await db.createTaxObligation({
          ...rest,
          description: input.description || null,
          fixedDueDates: fixedDueDates && fixedDueDates.length > 0 ? JSON.stringify(fixedDueDates) : null,
        });
        return { id };
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        frequency: z.enum(["mensual", "bimestral", "cuatrimestral", "semestral", "anual"]).optional(),
        installments: z.number().min(1).max(12).optional(),
        fixedDueDates: z.array(z.string().regex(/^\d{2}-\d{2}$/, "Formato debe ser MM-DD")).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, fixedDueDates, ...rest } = input;
        const data: any = { ...rest };
        if (fixedDueDates !== undefined) {
          data.fixedDueDates = fixedDueDates.length > 0 ? JSON.stringify(fixedDueDates) : null;
        }
        await db.updateTaxObligation(id, data);
        return { success: true };
      }),
    setActive: adminProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setTaxObligationActive(input.id, input.isActive);
        return { success: true };
      }),
    /** One-off fix for obligations deactivated before the automatic cleanup
     * existed — removes leftover pending/never-started deadlines from
     * currently inactive obligations. Never touches ones with evidence. */
    cleanupInactiveDeadlines: adminProcedure
      .mutation(async () => {
        const count = await db.cleanupInactiveObligationDeadlines();
        return { count };
      }),
    getClientObligations: protectedProcedure
      .input(z.object({ clientId: z.number() }))
      .query(async ({ input }) => {
        return db.getClientObligations(input.clientId);
      }),
    setClientObligations: protectedProcedure
      .input(z.object({ clientId: z.number(), obligationIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        await db.setClientObligations(input.clientId, input.obligationIds);
        return { success: true };
      }),
  }),

  deadlines: router({
    getByClient: protectedProcedure
      .input(z.object({ clientId: z.number() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          const client = await db.getClientById(input.clientId);
          if (!client || client.managerId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a este cliente" });
          }
        }
        return db.getClientDeadlines(input.clientId);
      }),
    getUpcoming: protectedProcedure
      .input(z.object({ daysAhead: z.number().optional() }).optional())
      .query(async ({ input, ctx }) => {
        return db.getUpcomingDeadlines(
          input?.daysAhead || 30,
          ctx.user.role === "admin" ? undefined : ctx.user.id
        );
      }),
    getForMonth: protectedProcedure
      .input(z.object({ year: z.number(), month: z.number() }))
      .query(async ({ input, ctx }) => {
        return db.getDeadlinesForMonth(
          input.year,
          input.month,
          ctx.user.role === "admin" ? undefined : ctx.user.id
        );
      }),
    generate: protectedProcedure
      .input(z.object({ clientId: z.number(), year: z.number() }))
      .mutation(async ({ input }) => {
        const client = await db.getClientById(input.clientId);
        if (!client) throw new Error("Cliente no encontrado");
        const allObligations = await db.getClientObligations(input.clientId);
        // Skip obligations that were deactivated in the catalog since being
        // assigned to this client — otherwise regenerating the calendar
        // would recreate deadlines we specifically cleaned up on deactivation.
        const inactiveSkipped = allObligations.filter((o: any) => !o.obligationIsActive).map((o: any) => o.obligationName);
        const obligations = allObligations.filter((o: any) => o.obligationIsActive);
        if (obligations.length === 0) throw new Error("El cliente no tiene obligaciones activas asignadas");

        const lastDigit = client.nit ? client.nit.slice(-1) : "0";

        // Try to use DIAN calendar entries first
        const deadlines: any[] = [];
        for (const obl of obligations) {
          // Obligations with fixed annual dates (e.g. Cámara de Comercio,
          // Supersalud, Supersociedades) don't depend on the client's NIT and
          // aren't sourced from the DIAN calendar — use them directly.
          if (obl.fixedDueDates) {
            let fixedDates: string[] = [];
            try {
              fixedDates = JSON.parse(obl.fixedDueDates);
            } catch {
              fixedDates = [];
            }
            for (const md of fixedDates) {
              const [month, day] = md.split("-").map(Number);
              if (!month || !day) continue;
              deadlines.push({
                clientId: input.clientId,
                obligationId: obl.obligationId,
                period: `${input.year}-${md}`,
                dueDate: new Date(Date.UTC(input.year, month - 1, day)),
                lastDigitNit: "ALL",
                status: "pendiente",
              });
            }
            continue;
          }

          const periods = generatePeriods(obl.frequency, input.year, obl.installments || 1);
          for (const period of periods) {
            // Look up DIAN calendar (matches by single digit, two-digit range, or "ALL")
            const dianEntry = await db.getDianCalendarForDeadline(input.year, obl.obligationCode, client.nit || "", period);
            const dueDate = dianEntry ? new Date(dianEntry.dueDate) : generateDefaultDueDate(obl.frequency, period, input.year, lastDigit);
            deadlines.push({
              clientId: input.clientId,
              obligationId: obl.obligationId,
              period,
              dueDate,
              lastDigitNit: dianEntry ? dianEntry.lastDigitNit : lastDigit,
              status: "pendiente",
            });
          }
        }

        // Deletes only the never-started ones (see deleteClientDeadlines);
        // anything already completed/in-progress-with-evidence survives.
        await db.deleteClientDeadlines(input.clientId);

        // Don't re-insert a deadline for an obligation+period that already
        // has a surviving (evidenced) entry — that would create a duplicate
        // sitting right next to the real, completed one.
        const preserved = await db.getClientDeadlines(input.clientId);
        const preservedKeys = new Set(preserved.map((d: any) => `${d.obligationId}|${d.period}`));
        const toInsert = deadlines.filter(d => !preservedKeys.has(`${d.obligationId}|${d.period}`));

        if (toInsert.length > 0) await db.createTaxDeadlines(toInsert);

        let message = `${toInsert.length} vencimiento(s) generados`;
        if (inactiveSkipped.length > 0) {
          message += `. Obligaciones inactivas no incluidas: ${inactiveSkipped.join(", ")}`;
        }
        if (preserved.length > toInsert.length) {
          message += `. ${preserved.length} vencimiento(s) con evidencia existente se conservaron sin cambios.`;
        }
        return { count: toInsert.length, message };
      }),
    updateStatus: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(["pendiente", "en_progreso", "vencido"]) }))
      .mutation(async ({ input, ctx }) => {
        await db.updateDeadlineStatus(input.id, input.status, ctx.user.id);
        return { success: true };
      }),
    /** Marks a deadline as completed — requires supporting evidence, same as
     * tasks. Non-admins may only complete deadlines for clients they manage. */
    complete: protectedProcedure
      .input(z.object({
        id: z.number(),
        clientId: z.number(),
        evidenceFiles: z.array(z.object({
          url: z.string(),
          key: z.string().optional(),
          fileName: z.string(),
          contentType: z.string().optional(),
          fileSize: z.number().optional(),
        })).min(1, "Debe adjuntar al menos un archivo de evidencia"),
        driveSubfolder: z.string().optional(),
        driveSubfolderId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          const client = await db.getClientById(input.clientId);
          if (!client || client.managerId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a este cliente" });
          }
        }
        const [firstFile] = input.evidenceFiles;
        await db.completeDeadline(input.id, firstFile.url, firstFile.key || null, ctx.user.id, input.driveSubfolder);
        for (const file of input.evidenceFiles) {
          await db.createDeadlineAttachment({
            deadlineId: input.id,
            fileName: file.fileName,
            fileUrl: file.url,
            fileKey: file.key || file.url,
            contentType: file.contentType || null,
            fileSize: file.fileSize || null,
            uploadedById: ctx.user.id,
          });
        }
        if (input.driveSubfolder && !input.driveSubfolderId) {
          await db.ensureClientDriveSubfolder(input.clientId, input.driveSubfolder);
        }
        pushEvidenceToDrive(input.clientId, input.driveSubfolder, input.evidenceFiles, input.driveSubfolderId).catch(err =>
          console.error("[Google Drive] Error subiendo evidencia del vencimiento:", err)
        );
        await db.logHistoryEvent("deadline", input.id, "completada", ctx.user.id);
        return { success: true };
      }),
    /** Admin-only: reopens a deadline mistakenly marked as completed. */
    reopen: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await db.reopenDeadline(input.id, ctx.user.id);
        return { success: true };
      }),
    getAttachments: protectedProcedure
      .input(z.object({ deadlineId: z.number() }))
      .query(async ({ input }) => {
        return db.getDeadlineAttachments(input.deadlineId);
      }),
    /** Admin reviews a completed deadline: approves it and can leave
     * observations/instructions the collaborator will see. */
    approve: adminProcedure
      .input(z.object({ id: z.number(), reviewNotes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        await db.approveDeadline(input.id, ctx.user.id, input.reviewNotes);
        const deadline = await db.getDeadlineById(input.id);
        const client = deadline ? await db.getClientById(deadline.clientId) : null;
        if (client?.managerId && client.managerId !== ctx.user.id) {
          await db.createNotification(client.managerId, "aprobada", "deadline", input.id, `${client.razonSocial} — período ${deadline!.period}`, input.reviewNotes, deadline!.clientId);
        }
        return { success: true };
      }),
    /** Admin sends a completed deadline back to the collaborator for
     * correction, with a required observation of what needs fixing. */
    requestCorrection: adminProcedure
      .input(z.object({ id: z.number(), reviewNotes: z.string().min(1, "Debe indicar qué corregir") }))
      .mutation(async ({ input, ctx }) => {
        await db.requestDeadlineCorrection(input.id, ctx.user.id, input.reviewNotes);
        const deadline = await db.getDeadlineById(input.id);
        const client = deadline ? await db.getClientById(deadline.clientId) : null;
        if (client?.managerId && client.managerId !== ctx.user.id) {
          await db.createNotification(client.managerId, "correccion_solicitada", "deadline", input.id, `${client.razonSocial} — período ${deadline!.period}`, input.reviewNotes, deadline!.clientId);
        }
        return { success: true };
      }),
    getHistory: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getHistory("deadline", input.id);
      }),
    /** Manually correct a deadline's due date when detected to be wrong
     * (e.g. an error in the DIAN calendar import or the fallback estimate) */
    updateDueDate: adminProcedure
      .input(z.object({ id: z.number(), dueDate: z.string() }))
      .mutation(async ({ input }) => {
        await db.updateDeadlineDueDate(input.id, new Date(input.dueDate));
        return { success: true };
      }),
    /** Upload a supporting document for a tax deadline (same key-suffix fix
     * as the other upload endpoints — always return the storagePut key). */
    uploadEvidence: protectedProcedure
      .input(z.object({
        fileName: z.string(),
        fileBase64: z.string(),
        contentType: z.string(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const rawKey = `deadline-evidence/${Date.now()}_${input.fileName}`;
        const { url, key } = await storagePut(rawKey, buffer, input.contentType);
        return { url, key };
      }),
  }),

  tasks: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getAllTasks(ctx.user.role === "admin" ? undefined : ctx.user.id);
    }),
    getByAssignee: protectedProcedure
      .input(z.object({ userId: z.number() }))
      .query(async ({ input }) => {
        return db.getTasksByAssignee(input.userId);
      }),
    getById: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const task = await db.getTaskById(input.id);
        if (!task) throw new Error("Tarea no encontrada");
        const attachments = await db.getTaskAttachments(input.id);
        return { ...task, attachments };
      }),
    create: adminProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        clientId: z.number(),
        assignedToId: z.number().optional(),
        dueDate: z.string().optional(),
        priority: z.enum(["baja", "media", "alta", "urgente"]).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await db.createTask({
          title: input.title,
          description: input.description || null,
          clientId: input.clientId,
          assignedToId: input.assignedToId || null,
          createdById: ctx.user.id,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          priority: input.priority || "media",
          status: "pendiente",
        });
        return { id };
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
        assignedToId: z.number().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        priority: z.enum(["baja", "media", "alta", "urgente"]).optional(),
        status: z.enum(["pendiente", "en_progreso", "completada", "vencida"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const updateData: any = { ...data };
        if (data.dueDate !== undefined) {
          updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
        }
        await db.updateTask(id, updateData);
        return { success: true };
      }),
    /** Complete task with evidence (confirmation + file upload). Non-admins may
     * only complete tasks assigned directly to them. */
    complete: protectedProcedure
      .input(z.object({
        id: z.number(),
        evidenceFiles: z.array(z.object({
          url: z.string(),
          key: z.string().optional(),
          fileName: z.string(),
          contentType: z.string().optional(),
          fileSize: z.number().optional(),
        })).min(1, "Debe adjuntar al menos un archivo de evidencia"),
        completionNotes: z.string().optional(),
        driveSubfolder: z.string().optional(),
        driveSubfolderId: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const task = await db.getTaskById(input.id);
        if (!task) throw new Error("Tarea no encontrada");
        if (ctx.user.role !== "admin") {
          if (task.assignedToId !== ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Solo puede completar tareas asignadas a usted",
            });
          }
        }
        const [firstFile] = input.evidenceFiles;
        await db.updateTask(input.id, {
          status: "completada",
          completedAt: new Date(),
          completedById: ctx.user.id,
          evidenceFileUrl: firstFile.url,
          evidenceFileKey: firstFile.key || null,
          completionNotes: input.completionNotes || null,
          driveSubfolder: input.driveSubfolder || null,
          // Clear any previous review outcome — this is a fresh submission
          // (possibly after a correction), so it should show as "sin
          // revisar" again, not the old approval/correction note.
          reviewStatus: null,
          reviewNotes: null,
          reviewedById: null,
          reviewedAt: null,
        });
        for (const file of input.evidenceFiles) {
          await db.createTaskAttachment({
            taskId: input.id,
            fileName: file.fileName,
            fileUrl: file.url,
            fileKey: file.key || file.url,
            contentType: file.contentType || null,
            fileSize: file.fileSize || null,
            uploadedById: ctx.user.id,
            isEvidence: true,
          });
        }
        if (input.driveSubfolder && !input.driveSubfolderId) {
          await db.ensureClientDriveSubfolder(task.clientId, input.driveSubfolder);
        }
        pushEvidenceToDrive(task.clientId, input.driveSubfolder, input.evidenceFiles, input.driveSubfolderId).catch(err =>
          console.error("[Google Drive] Error subiendo evidencia de la tarea:", err)
        );
        await db.logHistoryEvent("task", input.id, "completada", ctx.user.id);
        return { success: true };
      }),
    /** Admin can reopen a completed task */
    reopen: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await db.clearTaskAttachments(input.id);
        await db.updateTask(input.id, {
          status: "pendiente",
          completedAt: null,
          completedById: null,
          evidenceFileUrl: null,
          evidenceFileKey: null,
          driveSubfolder: null,
          completionNotes: null,
        });
        await db.logHistoryEvent("task", input.id, "reabierta", ctx.user.id);
        return { success: true };
      }),
    /** Admin-only: cancels a task no longer needed. Deletes it outright if
     * nothing was ever attached; otherwise keeps it (marked "cancelada") so
     * existing work isn't lost, just removed from active dashboard views. */
    cancel: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const result = await db.cancelTask(input.id, ctx.user.id);
        return { result };
      }),
    /** Upload attachment to a task */
    uploadAttachment: adminProcedure
      .input(z.object({
        taskId: z.number(),
        fileName: z.string(),
        fileBase64: z.string(),
        contentType: z.string(),
        fileSize: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const rawKey = `tasks/${input.taskId}/${Date.now()}_${input.fileName}`;
        const { url, key } = await storagePut(rawKey, buffer, input.contentType);
        const id = await db.createTaskAttachment({
          taskId: input.taskId,
          fileName: input.fileName,
          fileUrl: url,
          fileKey: key,
          contentType: input.contentType,
          fileSize: input.fileSize || buffer.length,
          uploadedById: ctx.user.id,
        });
        return { id, url, key, fileName: input.fileName };
      }),
    /** Upload evidence file for task completion */
    uploadEvidence: protectedProcedure
      .input(z.object({
        fileName: z.string(),
        fileBase64: z.string(),
        contentType: z.string(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const rawKey = `evidence/${Date.now()}_${input.fileName}`;
        const { url, key } = await storagePut(rawKey, buffer, input.contentType);
        return { url, key };
      }),
    getAttachments: protectedProcedure
      .input(z.object({ taskId: z.number() }))
      .query(async ({ input }) => {
        return db.getTaskAttachments(input.taskId);
      }),
    /** Admin reviews a completed task: approves it and can leave
     * observations/instructions the collaborator will see. */
    approve: adminProcedure
      .input(z.object({ id: z.number(), reviewNotes: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        await db.approveTask(input.id, ctx.user.id, input.reviewNotes);
        const task = await db.getTaskById(input.id);
        if (task?.assignedToId && task.assignedToId !== ctx.user.id) {
          const client = await db.getClientById(task.clientId);
          const title = client ? `${client.razonSocial} — ${task.title}` : task.title;
          await db.createNotification(task.assignedToId, "aprobada", "task", input.id, title, input.reviewNotes, task.clientId);
        }
        return { success: true };
      }),
    /** Admin sends a completed task back to the collaborator for
     * correction, with a required observation of what needs fixing. */
    requestCorrection: adminProcedure
      .input(z.object({ id: z.number(), reviewNotes: z.string().min(1, "Debe indicar qué corregir") }))
      .mutation(async ({ input, ctx }) => {
        await db.requestTaskCorrection(input.id, ctx.user.id, input.reviewNotes);
        const task = await db.getTaskById(input.id);
        if (task?.assignedToId && task.assignedToId !== ctx.user.id) {
          const client = await db.getClientById(task.clientId);
          const title = client ? `${client.razonSocial} — ${task.title}` : task.title;
          await db.createNotification(task.assignedToId, "correccion_solicitada", "task", input.id, title, input.reviewNotes, task.clientId);
        }
        return { success: true };
      }),
    getHistory: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        return db.getHistory("task", input.id);
      }),
  }),

  settings: router({
    getAll: adminProcedure.query(async () => {
      return db.getAllSettings();
    }),
    get: protectedProcedure
      .input(z.object({ key: z.string() }))
      .query(async ({ input }) => {
        return db.getSetting(input.key);
      }),
    set: adminProcedure
      .input(z.object({ key: z.string(), value: z.string(), description: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        await db.setSetting(input.key, input.value, input.description, ctx.user.id);
        return { success: true };
      }),
  }),

  dianCalendar: router({
    getEntries: protectedProcedure
      .input(z.object({ year: z.number(), obligationCode: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getDianCalendarEntries(input.year, input.obligationCode);
      }),
    /** Copies already-loaded calendar dates from one obligation to another
     * for the same year — e.g. "Consumo" officially follows the same dates
     * as "IVA Bimestral", so there's no need to re-extract or retype them. */
    copyFromObligation: adminProcedure
      .input(z.object({
        year: z.number(),
        fromObligationCode: z.string(),
        toObligationCode: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const count = await db.copyDianCalendarEntries(
          input.year,
          input.fromObligationCode,
          input.toObligationCode,
          ctx.user.id
        );
        return { count };
      }),
    /** Admin uploads DIAN calendar data (parsed from Excel/CSV) */
    upload: adminProcedure
      .input(z.object({
        year: z.number(),
        entries: z.array(z.object({
          obligationCode: z.string(),
          period: z.string(),
          lastDigitNit: z.string(),
          dueDate: z.string(),
        })),
        clearExisting: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (input.clearExisting) {
          await db.clearDianCalendar(input.year);
        }
        const entries = input.entries.map(e => ({
          year: input.year,
          obligationCode: e.obligationCode,
          period: e.period,
          lastDigitNit: e.lastDigitNit,
          dueDate: new Date(e.dueDate),
          uploadedById: ctx.user.id,
        }));
        await db.insertDianCalendarEntries(entries);
        await db.setSetting("dian_calendar_year", String(input.year), "Año del calendario DIAN cargado", ctx.user.id);
        return { count: entries.length };
      }),
    uploadPdf: adminProcedure
      .input(z.object({
        fileName: z.string(),
        fileBase64: z.string(),
        contentType: z.string(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.fileBase64, "base64");
        const rawKey = `dian-calendar/${Date.now()}_${input.fileName}`;
        const { url, key } = await storagePut(rawKey, buffer, input.contentType);
        return { url, key };
      }),
    /** Starts reading the official DIAN calendar PDF with AI in the
     * background and returns immediately with a jobId. The full extraction
     * (one AI call per obligation, spaced out to respect the API rate limit)
     * can take several minutes — far too long for a single HTTP request to
     * survive proxies/load balancers, so the client polls getExtractionStatus
     * instead of waiting on this call. */
    startExtraction: adminProcedure
      .input(z.object({ fileKey: z.string(), year: z.number() }))
      .mutation(async ({ input }) => {
        pruneOldExtractionJobs();
        const jobId = crypto.randomUUID();
        dianExtractionJobs.set(jobId, {
          status: "processing",
          progress: { current: 0, total: 0, currentObligation: "" },
          startedAt: Date.now(),
        });
        // Intentionally not awaited: this runs in the background while the
        // mutation itself returns right away.
        runDianExtractionJob(jobId, input.fileKey, input.year).catch(err => {
          const job = dianExtractionJobs.get(jobId);
          if (job) {
            job.status = "failed";
            job.error = err instanceof Error ? err.message : "Error inesperado";
          }
        });
        return { jobId };
      }),
    getExtractionStatus: adminProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => {
        const job = dianExtractionJobs.get(input.jobId);
        if (!job) {
          return { status: "not_found" as const, progress: null, result: null, error: "El trabajo ya no está disponible (puede haber expirado)." };
        }
        return { status: job.status, progress: job.progress, result: job.result ?? null, error: job.error ?? null };
      }),
  }),

  dashboard: router({
    summary: protectedProcedure
      .input(z.object({
        month: z.string().optional(), // "YYYY-MM"
        clientId: z.number().optional(),
        assignedToId: z.number().optional(),
        obligationId: z.number().optional(),
      }).optional())
      .query(async ({ input, ctx }) => {
        const now = new Date();
        const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        return db.getDashboardData({
          month: input?.month || defaultMonth,
          clientId: input?.clientId,
          assignedToId: input?.assignedToId,
          obligationId: input?.obligationId,
          managerId: ctx.user.role === "admin" ? undefined : ctx.user.id,
        });
      }),
  }),
  /** Admin-only screen to review everything marked as done — completed
   * tasks and completed tax deadlines together, with their evidence. */
  review: router({
    list: adminProcedure
      .input(z.object({
        month: z.string().optional(), // "YYYY-MM", omit for all-time
        clientId: z.number().optional(),
        assignedToId: z.number().optional(),
        obligationId: z.number().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getCompletedItemsForReview({
          month: input?.month,
          clientId: input?.clientId,
          assignedToId: input?.assignedToId,
          obligationId: input?.obligationId,
        });
      }),
  }),
  /** Basic AI assistant for collaborators — answers questions about a
   * specific client using the evidence files already uploaded for that
   * client's completed tasks and deadlines as real context, instead of
   * guessing. */
  assistant: router({
    chat: protectedProcedure
      .input(z.object({
        clientId: z.number(),
        message: z.string().min(1),
        history: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const client = await db.getClientById(input.clientId);
        if (!client) throw new Error("Cliente no encontrado");
        if (ctx.user.role !== "admin" && client.managerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a este cliente" });
        }

        // Content the assistant can actually "read" — evidence already
        // uploaded through the app (reliably fetchable), capped so the
        // request stays within reasonable size/cost.
        const evidence = await db.getClientEvidenceContext(input.clientId, 8);
        const evidenceBlocks = await Promise.all(
          evidence
            .filter(e => e.contentType === "application/pdf" || (e.contentType || "").startsWith("image/"))
            .map(async e => ({
              type: "file_url" as const,
              file_url: {
                url: await storageGetSignedUrl(e.fileKey || e.fileUrl.replace(/^\/files\//, "")),
                mime_type: e.contentType || "application/pdf",
              },
            }))
        );
        const evidenceList = evidence.map(e => `- ${e.title} (${e.detail}${e.date ? `, ${new Date(e.date).toLocaleDateString("es-CO")}` : ""})`).join("\n");

        // Full Drive folder listing — awareness only (names/paths/dates),
        // not full content, since a client's folder can hold far more
        // documents than fit in one conversation.
        let driveFilesList = "";
        if (isDriveConfigured() && client.driveFolderUrl) {
          const rootFolderId = extractFolderIdFromUrl(client.driveFolderUrl);
          if (rootFolderId) {
            try {
              const allFiles = await listAllFilesRecursive(rootFolderId);
              driveFilesList = allFiles
                .slice(0, 100)
                .map(f => `- ${f.path} (modificado ${new Date(f.modifiedTime).toLocaleDateString("es-CO")})`)
                .join("\n");
            } catch (err) {
              console.error("[Asistente IA] Error listando archivos de Drive:", err);
            }
          }
        }

        // Operational context: tasks, deadlines, and their comments.
        const { tasks: clientTasks, deadlines: clientDeadlines } = await db.getClientOperationalContext(input.clientId);
        const tasksSummary = clientTasks.map(t => {
          const commentsText = t.comments.length > 0
            ? "\n  Comentarios: " + t.comments.map((c: any) => `[${c.authorName}: ${c.content}]`).join(" ")
            : "";
          return `- "${t.title}" — estado: ${t.status}, asignada a: ${t.assignedToName || "sin asignar"}${t.dueDate ? `, vence: ${new Date(t.dueDate).toLocaleDateString("es-CO")}` : ""}${t.completionNotes ? `, notas: ${t.completionNotes}` : ""}${commentsText}`;
        }).join("\n");
        const deadlinesSummary = clientDeadlines.map(d => {
          const commentsText = d.comments.length > 0
            ? "\n  Comentarios: " + d.comments.map((c: any) => `[${c.authorName}: ${c.content}]`).join(" ")
            : "";
          return `- ${d.obligationName} — período ${d.period}, estado: ${d.status}, vence: ${new Date(d.dueDate).toLocaleDateString("es-CO")}${commentsText}`;
        }).join("\n");

        const systemPrompt = `Eres un asistente contable para el equipo de Areda SAS, una firma de contaduría en Colombia. Estás ayudando a un colaborador con preguntas sobre el cliente "${client.razonSocial}" (NIT ${client.nit}).

Documentos con contenido disponible para leer (soportes ya subidos de tareas y vencimientos completados de este cliente):
${evidenceList || "No hay documentos de soporte cargados aún para este cliente."}

${driveFilesList ? `Otros documentos que existen en la carpeta de Drive del cliente (solo conoces el nombre y la fecha, NO el contenido — si el usuario necesita el contenido de alguno de estos, dile que lo abra manualmente en Drive):\n${driveFilesList}\n` : ""}
Tareas de este cliente (con sus comentarios, si tienen):
${tasksSummary || "No hay tareas registradas para este cliente."}

Vencimientos tributarios de este cliente (con sus comentarios, si tienen):
${deadlinesSummary || "No hay vencimientos registrados para este cliente."}

Responde basándote en esta información cuando sea posible. Si la pregunta requiere el contenido de un documento que no tienes disponible (solo aparece en la lista de "otros documentos"), dile al usuario que lo revise directamente en Drive en vez de inventar su contenido. Sé conciso y directo, como corresponde a un contexto de trabajo contable.`;

        const historyMessages = (input.history || []).map(h => ({ role: h.role, content: h.content }));

        const response = await invokeLLM({
          max_tokens: 2000,
          messages: [
            { role: "system", content: systemPrompt },
            ...historyMessages,
            {
              role: "user",
              content: [
                { type: "text" as const, text: input.message },
                ...evidenceBlocks,
              ],
            },
          ],
        });

        const rawContent = response.choices?.[0]?.message?.content || "";
        const answer = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        return { answer };
      }),
  }),
  /** Self-reported clock in/out — replaces the in-person biometric register.
   * The collaborator marks their own start of day, lunch out/in, and end of
   * day; nothing is inferred or tracked automatically. */
  timeTracking: router({
    mark: protectedProcedure
      .input(z.object({ type: z.enum(["inicio", "salida_almuerzo", "regreso_almuerzo", "fin"]) }))
      .mutation(async ({ input, ctx }) => {
        await db.createTimeEntry(ctx.user.id, input.type);
        return { success: true };
      }),
    /** The client computes "today" using its own local clock and sends the
     * exact range — avoids the server having to guess the collaborator's
     * timezone for what "today" means. */
    getToday: protectedProcedure
      .input(z.object({ startOfDay: z.string(), endOfDay: z.string() }))
      .query(async ({ input, ctx }) => {
        return db.getUserTimeEntries(ctx.user.id, new Date(input.startOfDay), new Date(input.endOfDay));
      }),
    /** Restricted to a single specific admin (Arlex) by explicit request —
     * attendance/hours data about the team is sensitive enough that even
     * other admins shouldn't see it by default. */
    getLog: adminProcedure
      .input(z.object({ startOfDay: z.string(), endOfDay: z.string(), userId: z.number().optional() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.cedula !== ASISTENCIA_AUTHORIZED_CEDULA) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Esta sección está restringida" });
        }
        return db.getTimeTrackingLog(new Date(input.startOfDay), new Date(input.endOfDay), input.userId);
      }),
    /** Saves the collaborator's own hour-by-hour plan for one work block
     * (in house / a specific client / on leave) — exactly 4 slots. */
    saveLocation: protectedProcedure
      .input(z.object({
        date: z.string(), // "YYYY-MM-DD", the collaborator's own calendar day
        block: z.enum(["morning", "afternoon"]),
        slots: z.array(z.object({
          type: z.enum(["in_house", "client", "libre"]),
          clientId: z.number().optional(),
        })).length(4),
      }))
      .mutation(async ({ input, ctx }) => {
        await db.saveWorkLocation(ctx.user.id, input.date, input.block, input.slots);
        return { success: true };
      }),
    getMyLocation: protectedProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input, ctx }) => {
        return db.getWorkLocation(ctx.user.id, input.date);
      }),
    /** Restricted the same way as getLog — everyone's location plan for a
     * given day, for the Asistencia admin view. */
    getLocationsForDate: adminProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input, ctx }) => {
        if (ctx.user.cedula !== ASISTENCIA_AUTHORIZED_CEDULA) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Esta sección está restringida" });
        }
        return db.getWorkLocationsForDate(input.date);
      }),
  }),
  /** Comments on a specific task or deadline — for asking/flagging things
   * about that item directly ("revisa el adjunto, faltó algo"), instead of
   * a general chat between users. */
  comments: router({
    list: protectedProcedure
      .input(z.object({ entityType: z.enum(["task", "deadline"]), entityId: z.number() }))
      .query(async ({ input, ctx }) => {
        if (input.entityType === "task") {
          const task = await db.getTaskById(input.entityId);
          if (!task) throw new Error("Tarea no encontrada");
          if (ctx.user.role !== "admin" && task.assignedToId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta tarea" });
          }
        } else {
          const deadline = await db.getDeadlineById(input.entityId);
          if (!deadline) throw new Error("Vencimiento no encontrado");
          if (ctx.user.role !== "admin") {
            const client = await db.getClientById(deadline.clientId);
            if (!client || client.managerId !== ctx.user.id) {
              throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a este vencimiento" });
            }
          }
        }
        return db.getComments(input.entityType, input.entityId);
      }),
    create: protectedProcedure
      .input(z.object({ entityType: z.enum(["task", "deadline"]), entityId: z.number(), content: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        if (input.entityType === "task") {
          const task = await db.getTaskById(input.entityId);
          if (!task) throw new Error("Tarea no encontrada");
          if (ctx.user.role !== "admin" && task.assignedToId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a esta tarea" });
          }
          await db.createComment(input.entityType, input.entityId, ctx.user.id, input.content);
          // Notify whoever isn't the one commenting: the assignee if an
          // admin commented, or the person who created the task if the
          // assignee themselves commented.
          const recipient = task.assignedToId !== ctx.user.id ? task.assignedToId : task.createdById;
          if (recipient && recipient !== ctx.user.id) {
            const client = await db.getClientById(task.clientId);
            const title = client ? `${client.razonSocial} — ${task.title}` : task.title;
            await db.createNotification(recipient, "comentario", "task", task.id, title, input.content, task.clientId);
          }
        } else {
          const deadline = await db.getDeadlineById(input.entityId);
          if (!deadline) throw new Error("Vencimiento no encontrado");
          const client = await db.getClientById(deadline.clientId);
          if (ctx.user.role !== "admin") {
            if (!client || client.managerId !== ctx.user.id) {
              throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a este vencimiento" });
            }
          }
          await db.createComment(input.entityType, input.entityId, ctx.user.id, input.content);
          if (client?.managerId && client.managerId !== ctx.user.id) {
            await db.createNotification(client.managerId, "comentario", "deadline", deadline.id, `${client.razonSocial} — período ${deadline.period}`, input.content, deadline.clientId);
          }
        }
        return { success: true };
      }),
  }),
  /** Real Google Drive integration (service account) — lets the admin
   * verify the connection, and lets anyone browse a client's actual Drive
   * subfolders when uploading evidence. */
  googleDrive: router({
    isConfigured: protectedProcedure.query(() => isDriveConfigured()),
    /** Admin-only: confirms the credentials work AND that a specific
     * client's folder was actually shared with the service account. */
    testConnection: adminProcedure
      .input(z.object({ clientId: z.number() }))
      .query(async ({ input }) => {
        if (!isDriveConfigured()) {
          throw new Error("Google Drive no está configurado — faltan las variables de entorno en Railway");
        }
        const client = await db.getClientById(input.clientId);
        if (!client?.driveFolderUrl) throw new Error("Este cliente no tiene una carpeta de Drive configurada");
        const folderId = extractFolderIdFromUrl(client.driveFolderUrl);
        if (!folderId) throw new Error("No se pudo interpretar el enlace de la carpeta de Drive");
        const folder = await testFolderAccess(folderId);
        return { success: true, folderName: folder.name };
      }),
    /** Real subfolders inside a client's Drive folder (falls back to the
     * remembered-name list on the frontend if Drive isn't configured). */
    listSubfolders: protectedProcedure
      .input(z.object({ clientId: z.number() }))
      .query(async ({ input, ctx }) => {
        const client = await db.getClientById(input.clientId);
        if (!client) throw new Error("Cliente no encontrado");
        if (ctx.user.role !== "admin" && client.managerId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No tiene acceso a este cliente" });
        }
        if (!client.driveFolderUrl || !isDriveConfigured()) return [];
        const folderId = extractFolderIdFromUrl(client.driveFolderUrl);
        if (!folderId) return [];
        return listSubfoldersRecursive(folderId);
      }),
  }),
  /** In-app notifications — lets a collaborator know something happened on
   * a task/deadline they care about (comment, approval, correction) without
   * having to stumble onto it by chance. */
  notifications: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().optional() }).optional())
      .query(async ({ input, ctx }) => {
        return db.getNotifications(ctx.user.id, input?.limit);
      }),
    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      // Piggyback housekeeping on this frequent poll instead of a separate
      // scheduled job — deletes old READ notifications only.
      await db.cleanupOldReadNotifications(ctx.user.id);
      return db.getUnreadNotificationCount(ctx.user.id);
    }),
    markRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        await db.markNotificationRead(input.id, ctx.user.id);
        return { success: true };
      }),
    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await db.markAllNotificationsRead(ctx.user.id);
      return { success: true };
    }),
  }),
});

export type AppRouter = typeof appRouter;

// ==================== HELPER FUNCTIONS ====================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** When the AI's response gets cut off mid-way (hit the token limit or a
 * network hiccup), the JSON as a whole is invalid — but most individual
 * entry objects before the cutoff are still complete. Extract those instead
 * of discarding everything. Entries here are flat objects (no nesting), so a
 * simple non-greedy `{...}` match reliably finds each complete one. */
function rescueEntriesFromTruncatedJson(jsonStr: string): any[] {
  const matches = jsonStr.match(/\{[^{}]*\}/g) || [];
  const rescued: any[] = [];
  for (const m of matches) {
    try {
      const obj = JSON.parse(m);
      if (obj && typeof obj === "object" && obj.obligationCode && obj.period && obj.dueDate) {
        rescued.push(obj);
      }
    } catch {
      // Skip fragments that still don't parse on their own
    }
  }
  return rescued;
}

function generatePeriods(frequency: string, year: number, installments: number = 1): string[] {
  switch (frequency) {
    case "mensual":
      return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    case "bimestral":
      return [`${year}-01-02`, `${year}-03-04`, `${year}-05-06`, `${year}-07-08`, `${year}-09-10`, `${year}-11-12`];
    case "cuatrimestral":
      return [`${year}-01-04`, `${year}-05-08`, `${year}-09-12`];
    case "semestral":
      return [`${year}-01-06`, `${year}-07-12`];
    case "anual":
      if (installments > 1) {
        return Array.from({ length: installments }, (_, i) => `${year}-cuota${i + 1}`);
      }
      return [`${year}`];
    default:
      return [`${year}`];
  }
}

function generateDefaultDueDate(frequency: string, period: string, year: number, lastDigit: string): Date {
  const digitOffset = parseInt(lastDigit) || 0;
  
  switch (frequency) {
    case "mensual": {
      const month = parseInt(period.split("-")[1]);
      const nextMonth = month + 1 > 12 ? 1 : month + 1;
      const nextYear = month + 1 > 12 ? year + 1 : year;
      return new Date(Date.UTC(nextYear, nextMonth - 1, 10 + digitOffset));
    }
    case "bimestral": {
      const endMonth = parseInt(period.split("-")[1].split("-")[0]) + 1;
      const biMonth = endMonth + 1 > 12 ? 1 : endMonth + 1;
      const biYear = endMonth + 1 > 12 ? year + 1 : year;
      return new Date(Date.UTC(biYear, biMonth - 1, 10 + digitOffset));
    }
    case "cuatrimestral": {
      const parts = period.split("-");
      const endM = parseInt(parts[1]) || 4;
      const cuatMonth = endM + 1 > 12 ? 1 : endM + 1;
      const cuatYear = endM + 1 > 12 ? year + 1 : year;
      return new Date(Date.UTC(cuatYear, cuatMonth - 1, 10 + digitOffset));
    }
    case "semestral": {
      const parts = period.split("-");
      const endM = parseInt(parts[1]) || 6;
      const semMonth = endM + 1 > 12 ? 1 : endM + 1;
      const semYear = endM + 1 > 12 ? year + 1 : year;
      return new Date(Date.UTC(semYear, semMonth - 1, 10 + digitOffset));
    }
    case "anual": {
      const cuotaMatch = period.match(/cuota(\d+)/);
      if (cuotaMatch) {
        const cuotaNum = parseInt(cuotaMatch[1]);
        // Rough fallback spacing between installments (only used if no DIAN entry exists)
        const month = 3 + (cuotaNum - 1) * 2; // cuota1 → abr, cuota2 → jun, cuota3 → ago
        return new Date(Date.UTC(year + 1, month, 10 + digitOffset));
      }
      return new Date(Date.UTC(year + 1, 3, 10 + digitOffset)); // April next year
    }
    default:
      return new Date(Date.UTC(year, 11, 31));
  }
}
