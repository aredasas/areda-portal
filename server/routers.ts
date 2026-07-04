import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { storagePut, storageGetSignedUrl } from "./storage";
import { invokeLLM } from "./_core/llm";
import { sdk } from "./_core/sdk";
import { ONE_YEAR_MS } from "@shared/const";
import bcrypt from "bcryptjs";

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
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
        frequency: z.enum(["mensual", "bimestral", "cuatrimestral", "anual"]),
      }))
      .mutation(async ({ input }) => {
        const id = await db.createTaxObligation({ ...input, description: input.description || null });
        return { id };
      }),
    update: adminProcedure
      .input(z.object({
        id: z.number(),
        code: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        frequency: z.enum(["mensual", "bimestral", "cuatrimestral", "anual"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await db.updateTaxObligation(id, data);
        return { success: true };
      }),
    setActive: adminProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.setTaxObligationActive(input.id, input.isActive);
        return { success: true };
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
      .query(async ({ input }) => {
        return db.getDeadlinesForMonth(input.year, input.month);
      }),
    generate: protectedProcedure
      .input(z.object({ clientId: z.number(), year: z.number() }))
      .mutation(async ({ input }) => {
        const client = await db.getClientById(input.clientId);
        if (!client) throw new Error("Cliente no encontrado");
        const obligations = await db.getClientObligations(input.clientId);
        if (obligations.length === 0) throw new Error("El cliente no tiene obligaciones asignadas");

        const lastDigit = client.nit ? client.nit.slice(-1) : "0";
        
        // Try to use DIAN calendar entries first
        const deadlines: any[] = [];
        for (const obl of obligations) {
          const periods = generatePeriods(obl.frequency, input.year);
          for (const period of periods) {
            // Look up DIAN calendar
            const dianEntry = await db.getDianCalendarForDeadline(input.year, obl.obligationCode, lastDigit, period);
            const dueDate = dianEntry ? new Date(dianEntry.dueDate) : generateDefaultDueDate(obl.frequency, period, input.year, lastDigit);
            deadlines.push({
              clientId: input.clientId,
              obligationId: obl.obligationId,
              period,
              dueDate,
              lastDigitNit: lastDigit,
              status: "pendiente",
            });
          }
        }

        await db.deleteClientDeadlines(input.clientId);
        if (deadlines.length > 0) await db.createTaxDeadlines(deadlines);
        return { count: deadlines.length };
      }),
    updateStatus: protectedProcedure
      .input(z.object({ id: z.number(), status: z.enum(["pendiente", "completado", "vencido"]) }))
      .mutation(async ({ input, ctx }) => {
        await db.updateDeadlineStatus(input.id, input.status, ctx.user.id);
        return { success: true };
      }),
    /** Manually correct a deadline's due date when detected to be wrong
     * (e.g. an error in the DIAN calendar import or the fallback estimate) */
    updateDueDate: adminProcedure
      .input(z.object({ id: z.number(), dueDate: z.string() }))
      .mutation(async ({ input }) => {
        await db.updateDeadlineDueDate(input.id, new Date(input.dueDate));
        return { success: true };
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
        evidenceFileUrl: z.string().optional(),
        evidenceFileKey: z.string().optional(),
        completionNotes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!input.evidenceFileUrl) {
          throw new Error("Debe adjuntar evidencia para completar la tarea");
        }
        if (ctx.user.role !== "admin") {
          const task = await db.getTaskById(input.id);
          if (!task || task.assignedToId !== ctx.user.id) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Solo puede completar tareas asignadas a usted",
            });
          }
        }
        await db.updateTask(input.id, {
          status: "completada",
          completedAt: new Date(),
          evidenceFileUrl: input.evidenceFileUrl,
          evidenceFileKey: input.evidenceFileKey || null,
          completionNotes: input.completionNotes || null,
        });
        return { success: true };
      }),
    /** Admin can reopen a completed task */
    reopen: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.updateTask(input.id, {
          status: "pendiente",
          completedAt: null,
          evidenceFileUrl: null,
          evidenceFileKey: null,
          completionNotes: null,
        });
        return { success: true };
      }),
    /** Upload attachment to a task */
    uploadAttachment: protectedProcedure
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
  }),

  dashboard: router({
    summary: protectedProcedure.query(async () => {
      const [taskStats, upcomingDeadlines, workload, tasksByStatus] = await Promise.all([
        db.getTaskStats(),
        db.getUpcomingDeadlines(30),
        db.getWorkloadByUser(),
        db.getRecentTasksByStatus(5),
      ]);
      return { taskStats, upcomingDeadlines, workload, tasksByStatus };
    }),
  }),
});

export type AppRouter = typeof appRouter;

// ==================== HELPER FUNCTIONS ====================

function generatePeriods(frequency: string, year: number): string[] {
  switch (frequency) {
    case "mensual":
      return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
    case "bimestral":
      return [`${year}-01-02`, `${year}-03-04`, `${year}-05-06`, `${year}-07-08`, `${year}-09-10`, `${year}-11-12`];
    case "cuatrimestral":
      return [`${year}-01-04`, `${year}-05-08`, `${year}-09-12`];
    case "anual":
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
      return new Date(nextYear, nextMonth - 1, 10 + digitOffset);
    }
    case "bimestral": {
      const endMonth = parseInt(period.split("-")[1].split("-")[0]) + 1;
      const biMonth = endMonth + 1 > 12 ? 1 : endMonth + 1;
      const biYear = endMonth + 1 > 12 ? year + 1 : year;
      return new Date(biYear, biMonth - 1, 10 + digitOffset);
    }
    case "cuatrimestral": {
      const parts = period.split("-");
      const endM = parseInt(parts[1]) || 4;
      const cuatMonth = endM + 1 > 12 ? 1 : endM + 1;
      const cuatYear = endM + 1 > 12 ? year + 1 : year;
      return new Date(cuatYear, cuatMonth - 1, 10 + digitOffset);
    }
    case "anual":
      return new Date(year + 1, 3, 10 + digitOffset); // April next year
    default:
      return new Date(year, 11, 31);
  }
}
