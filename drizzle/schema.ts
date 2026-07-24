import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, double, index, uniqueIndex } from "drizzle-orm/mysql-core";

/**
 * Users table - Colaboradores de la firma
 * Roles: admin, contador_senior, contador_junior, asistente
 * Auth: username (cédula o nombre de usuario) + password hash
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  /** Username for local auth - can be cédula number or custom username */
  username: varchar("username", { length: 64 }).unique(),
  /** Bcrypt password hash for local auth */
  passwordHash: varchar("passwordHash", { length: 255 }),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  cedula: varchar("cedula", { length: 20 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "contador_senior", "contador_junior", "asistente"]).default("asistente").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  phone: varchar("phone", { length: 20 }),
  position: varchar("position", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Clients table - Clientes de la firma contable
 * Includes managerId for the assigned collaborator
 */
export const clients = mysqlTable("clients", {
  id: int("id").autoincrement().primaryKey(),
  razonSocial: varchar("razonSocial", { length: 255 }).notNull(),
  nit: varchar("nit", { length: 20 }).notNull(),
  digitoVerificacion: varchar("digitoVerificacion", { length: 1 }),
  direccion: text("direccion"),
  ciudad: varchar("ciudad", { length: 100 }),
  departamento: varchar("departamento", { length: 100 }),
  telefono: varchar("telefono", { length: 20 }),
  email: varchar("email", { length: 320 }),
  actividadEconomica: varchar("actividadEconomica", { length: 255 }),
  codigoCIIU: varchar("codigoCIIU", { length: 10 }),
  representanteLegal: varchar("representanteLegal", { length: 255 }),
  rutFileUrl: text("rutFileUrl"),
  rutFileKey: varchar("rutFileKey", { length: 255 }),
  /** Manager: collaborator assigned as responsible for this client */
  managerId: int("managerId"),
  /** URL of the Google Drive folder where this client's supporting documents are stored */
  driveFolderUrl: text("driveFolderUrl"),
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Client = typeof clients.$inferSelect;
export type InsertClient = typeof clients.$inferInsert;

/**
 * Tax obligations catalog - Obligaciones tributarias colombianas predefinidas
 */
export const taxObligations = mysqlTable("taxObligations", {
  id: int("id").autoincrement().primaryKey(),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  frequency: mysqlEnum("frequency", ["mensual", "bimestral", "cuatrimestral", "semestral", "anual"]).notNull(),
  /** For "anual" obligations paid in installments (e.g. Renta Grandes
   * Contribuyentes = 3 cuotas, Personas Jurídicas = 2 cuotas). 1 = single payment. */
  installments: int("installments").default(1).notNull(),
  /** JSON array of "MM-DD" dates (e.g. ["03-31"] or ["05-15","09-14"]) for
   * obligations with a fixed annual due date that does NOT depend on the
   * client's NIT and doesn't come from the DIAN calendar — e.g. renovación
   * de Cámara de Comercio, reportes a Supersalud o Supersociedades. When
   * set, deadline generation uses these dates directly for every client
   * with this obligation, skipping the NIT-based DIAN calendar lookup. */
  fixedDueDates: text("fixedDueDates"),
  isActive: boolean("isActive").default(true).notNull(),
});

export type TaxObligation = typeof taxObligations.$inferSelect;
export type InsertTaxObligation = typeof taxObligations.$inferInsert;

/**
 * Client-obligation relationship - Obligaciones asignadas a cada cliente
 */
export const clientObligations = mysqlTable("clientObligations", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  obligationId: int("obligationId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClientObligation = typeof clientObligations.$inferSelect;
export type InsertClientObligation = typeof clientObligations.$inferInsert;

/**
 * Tax deadlines - Vencimientos tributarios generados automáticamente
 */
export const taxDeadlines = mysqlTable("taxDeadlines", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  obligationId: int("obligationId").notNull(),
  period: varchar("period", { length: 20 }).notNull(),
  dueDate: timestamp("dueDate").notNull(),
  lastDigitNit: varchar("lastDigitNit", { length: 10 }),
  status: mysqlEnum("status", ["pendiente", "en_progreso", "completado", "vencido"]).default("pendiente").notNull(),
  completedAt: timestamp("completedAt"),
  completedById: int("completedById"),
  /** Supporting document the collaborator uploads when completing this deadline */
  evidenceFileUrl: text("evidenceFileUrl"),
  evidenceFileKey: text("evidenceFileKey"),
  /** Name of the subfolder (inside the client's single Drive folder link)
   * where the evidence was saved — free text, since the app doesn't browse
   * the real Drive folder structure. See clientDriveSubfolders below. */
  driveSubfolder: varchar("driveSubfolder", { length: 150 }),
  /** Set once an admin reviews a completed deadline — either approving it or
   * sending it back for correction. reviewStatus distinguishes which. */
  reviewStatus: mysqlEnum("reviewStatus", ["aprobado", "correccion"]),
  reviewNotes: text("reviewNotes"),
  reviewedById: int("reviewedById"),
  reviewedAt: timestamp("reviewedAt"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TaxDeadline = typeof taxDeadlines.$inferSelect;
export type InsertTaxDeadline = typeof taxDeadlines.$inferInsert;

/**
 * Tasks - Tareas manuales asignadas a colaboradores
 * Now supports attachments, evidence for completion, and reopening
 */
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  clientId: int("clientId").notNull(),
  assignedToId: int("assignedToId"),
  createdById: int("createdById").notNull(),
  dueDate: timestamp("dueDate"),
  status: mysqlEnum("status", ["pendiente", "en_progreso", "completada", "vencida", "cancelada"]).default("pendiente").notNull(),
  priority: mysqlEnum("priority", ["baja", "media", "alta", "urgente"]).default("media").notNull(),
  /** Whether this task was auto-generated from tax deadlines */
  isAutoGenerated: boolean("isAutoGenerated").default(false).notNull(),
  /** Reference to the tax deadline that generated this task (if auto-generated) */
  taxDeadlineId: int("taxDeadlineId"),
  /** Reference to the recurrence rule that generated this task, if it came
   * from a recurring task template rather than being created one-off. */
  recurrenceId: int("recurrenceId"),
  completedAt: timestamp("completedAt"),
  /** Who completed the task — needed to show a proper audit trail to admins */
  completedById: int("completedById"),
  /** Evidence file URL required to complete the task */
  evidenceFileUrl: text("evidenceFileUrl"),
  evidenceFileKey: varchar("evidenceFileKey", { length: 255 }),
  /** Name of the subfolder (inside the client's single Drive folder link)
   * where the evidence was saved — free text, since the app doesn't browse
   * the real Drive folder structure. See clientDriveSubfolders below. */
  driveSubfolder: varchar("driveSubfolder", { length: 150 }),
  /** Notes when completing the task */
  completionNotes: text("completionNotes"),
  /** Set once an admin reviews a completed task — either approving it or
   * sending it back for correction. reviewStatus distinguishes which. */
  reviewStatus: mysqlEnum("reviewStatus", ["aprobado", "correccion"]),
  reviewNotes: text("reviewNotes"),
  reviewedById: int("reviewedById"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

/**
 * Remembers the subfolder names collaborators have used per client, so the
 * next person completing a task/deadline for that client can pick from a
 * dropdown instead of retyping (and risking a slightly different spelling
 * that would look like a different folder).
 */
export const clientDriveSubfolders = mysqlTable("clientDriveSubfolders", {
  id: int("id").autoincrement().primaryKey(),
  clientId: int("clientId").notNull(),
  name: varchar("name", { length: 150 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClientDriveSubfolder = typeof clientDriveSubfolders.$inferSelect;
export type InsertClientDriveSubfolder = typeof clientDriveSubfolders.$inferInsert;

/**
 * Time entries - Self-reported clock-in/out marks (replaces the in-person
 * biometric register). Each collaborator marks their own start of day, lunch
 * break out/in, and end of day. Fully transparent — the collaborator marks
 * it themselves, nothing is inferred or tracked automatically.
 */
export const timeEntries = mysqlTable("timeEntries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["inicio", "salida_almuerzo", "regreso_almuerzo", "fin"]).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export type TimeEntry = typeof timeEntries.$inferSelect;
export type InsertTimeEntry = typeof timeEntries.$inferInsert;

/**
 * Task attachments - Files attached to tasks (Excel, Word, PDF, etc.)
 */
export const taskAttachments = mysqlTable("taskAttachments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 255 }).notNull(),
  contentType: varchar("contentType", { length: 100 }),
  fileSize: int("fileSize"),
  uploadedById: int("uploadedById").notNull(),
  /** True when this was uploaded as evidence while completing the task
   * (so it can be safely cleared on reopen, without touching general
   * reference attachments an admin added separately). */
  isEvidence: boolean("isEvidence").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = typeof taskAttachments.$inferInsert;

/** Same idea as taskAttachments, but for tax deadlines — lets a collaborator
 * attach several supporting files when completing a deadline, instead of
 * just one. */
export const deadlineAttachments = mysqlTable("deadlineAttachments", {
  id: int("id").autoincrement().primaryKey(),
  deadlineId: int("deadlineId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 255 }).notNull(),
  contentType: varchar("contentType", { length: 100 }),
  fileSize: int("fileSize"),
  uploadedById: int("uploadedById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DeadlineAttachment = typeof deadlineAttachments.$inferSelect;
export type InsertDeadlineAttachment = typeof deadlineAttachments.$inferInsert;

/**
 * App settings - Configurable settings (Drive folder URL, DIAN calendar, etc.)
 */
export const appSettings = mysqlTable("appSettings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value"),
  description: varchar("description", { length: 255 }),
  updatedById: int("updatedById"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = typeof appSettings.$inferInsert;

/**
 * DIAN Calendar entries - Custom uploaded calendar entries by admin
 * Each entry represents a specific deadline date for a specific obligation and NIT digit
 */
export const dianCalendar = mysqlTable("dianCalendar", {
  id: int("id").autoincrement().primaryKey(),
  year: int("year").notNull(),
  obligationCode: varchar("obligationCode", { length: 20 }).notNull(),
  period: varchar("period", { length: 20 }).notNull(),
  lastDigitNit: varchar("lastDigitNit", { length: 10 }).notNull(),
  dueDate: timestamp("dueDate").notNull(),
  uploadedById: int("uploadedById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DianCalendar = typeof dianCalendar.$inferSelect;
export type InsertDianCalendar = typeof dianCalendar.$inferInsert;

/**
 * Comments — free-text notes on a specific task or deadline, so people can
 * ask/flag things about that item directly ("revisa el adjunto, faltó algo")
 * instead of a general chat. entityType+entityId together point at the
 * task or deadline being discussed.
 */
export const comments = mysqlTable("comments", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", ["task", "deadline", "board_post"]).notNull(),
  entityId: int("entityId").notNull(),
  authorId: int("authorId").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

/**
 * History events — an append-only audit trail per task/deadline: when it
 * was created, completed, sent back for correction, approved, reopened,
 * etc. Lets Revisión show the full lifecycle instead of just the current
 * state, since a single item can go through several correction cycles.
 */
export const historyEvents = mysqlTable("historyEvents", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", ["task", "deadline"]).notNull(),
  entityId: int("entityId").notNull(),
  eventType: mysqlEnum("eventType", [
    "creada",
    "completada",
    "correccion_solicitada",
    "aprobada",
    "reabierta",
    "cancelada",
  ]).notNull(),
  userId: int("userId").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HistoryEvent = typeof historyEvents.$inferSelect;
export type InsertHistoryEvent = typeof historyEvents.$inferInsert;

/**
 * Notifications — lets a collaborator know something happened on a task or
 * deadline they care about (someone commented, it was approved, or sent
 * back for correction) without having to stumble onto it by chance.
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["comentario", "aprobada", "correccion_solicitada", "tablero_post"]).notNull(),
  entityType: mysqlEnum("entityType", ["task", "deadline", "board_post"]).notNull(),
  entityId: int("entityId").notNull(),
  /** So clicking a notification can jump straight to the right client's
   * deadlines view, without an extra lookup. */
  clientId: int("clientId"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Work location schedule — where a collaborator says they'll be during
 * each hour of a 4-hour work block (morning: 8-12, afternoon: 2-6),
 * declared when they mark "inicio" or "regreso_almuerzo". Each hour is
 * either "in_house", a specific assigned client, or "libre" (on leave).
 * One row per user+date+block; the 4 hourly choices live together as JSON
 * since they're always filled in and read as a single unit.
 */
export const workLocationEntries = mysqlTable("workLocationEntries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  date: varchar("date", { length: 10 }).notNull(), // "YYYY-MM-DD", collaborator's own calendar day
  block: mysqlEnum("block", ["morning", "afternoon"]).notNull(),
  /** JSON array of 4 entries, one per hour of the block:
   * [{ type: "in_house" | "client" | "libre", clientId?: number }, ...] */
  slots: text("slots").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WorkLocationEntry = typeof workLocationEntries.$inferSelect;
export type InsertWorkLocationEntry = typeof workLocationEntries.$inferInsert;

/**
 * Recurring task rules — a template that periodically generates real task
 * rows (each an independently trackable/completable instance with its own
 * evidence and history), instead of one task getting silently reset and
 * overwritten every cycle.
 */
export const taskRecurrences = mysqlTable("taskRecurrences", {
  id: int("id").autoincrement().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  clientId: int("clientId").notNull(),
  assignedToId: int("assignedToId"),
  priority: mysqlEnum("priority", ["baja", "media", "alta", "urgente"]).default("media").notNull(),
  createdById: int("createdById").notNull(),
  recurrenceType: mysqlEnum("recurrenceType", ["semanal", "quincenal", "mensual"]).notNull(),
  /** For "semanal": day of week, 0=domingo..6=sábado.
   * For "quincenal"/"mensual": day of month (1-31); quincenal repeats every
   * 15 days from that anchor day, mensual repeats once a month on that day
   * (capped to the last real day of shorter months). */
  dayOfWeek: int("dayOfWeek"),
  dayOfMonth: int("dayOfMonth"),
  isActive: boolean("isActive").default(true).notNull(),
  /** Marks the most recent period a task was generated for, so re-running
   * generation doesn't create duplicates within the same cycle. Format
   * depends on recurrenceType: "2026-W28" (semanal, ISO week), a plain
   * "YYYY-MM-DD" anchor date (quincenal), or "2026-07" (mensual). */
  lastGeneratedPeriod: varchar("lastGeneratedPeriod", { length: 20 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskRecurrence = typeof taskRecurrences.$inferSelect;
export type InsertTaskRecurrence = typeof taskRecurrences.$inferInsert;

/**
 * ============================================================
 * MÓDULO INFORMES — Financieros multi-cliente derivados del libro
 * auxiliar/movimiento contable. Incluye el Estado de Resultados
 * Mensual comparativo (ERM, el informe principal, por cliente,
 * sin importar si tiene centros de costo) y el ERI por centro de
 * costo (derivado, hoy solo aplica a clientes que sí los usan,
 * como Colfamil). Restringido por ahora al usuario con cédula
 * autorizada (ver INFORMES_AUTHORIZED_CEDULA en routers.ts).
 * ============================================================
 */

/** Catálogo de centros de costo por cliente (código -> nombre real).
 * Solo aplica a clientes que manejan centro de costo (ej. Colfamil);
 * para el resto simplemente no se siembra ninguno. Se siembra una
 * vez por cliente y luego es editable. */
export const informesCentrosCosto = mysqlTable("informesCentrosCosto", {
  id: int("id").autoincrement().primaryKey(),
  clienteId: int("clienteId").notNull(),
  codigo: varchar("codigo", { length: 4 }).notNull(),
  nombre: varchar("nombre", { length: 120 }).notNull(),
  activo: boolean("activo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  clienteCodigoIdx: uniqueIndex("informesCentrosCosto_cliente_codigo_idx").on(table.clienteId, table.codigo),
}));
export type InformeCentroCosto = typeof informesCentrosCosto.$inferSelect;
export type InsertInformeCentroCosto = typeof informesCentrosCosto.$inferInsert;

/** Catálogo de cuentas PUC, a nivel de detalle completo (hasta el código
 * exacto que traiga el libro auxiliar, típicamente 6+ dígitos — no se
 * trunca). Es compartido entre clientes: el PUC colombiano es un
 * estándar, así que la descripción de una cuenta no depende del cliente.
 * El tipo (ingreso/costo/gasto/descuento_pp) se deriva del primer
 * dígito, pero la descripción no viene en el libro auxiliar crudo, así
 * que se completa una sola vez por IA la primera vez que aparece. */
export const informesCuentasPuc = mysqlTable("informesCuentasPuc", {
  id: int("id").autoincrement().primaryKey(),
  cuenta: varchar("cuenta", { length: 12 }).notNull().unique(),
  descripcion: varchar("descripcion", { length: 255 }),
  tipo: mysqlEnum("tipo", ["ingreso", "costo", "gasto", "descuento_pp"]).notNull(),
  clasificadoPorIA: boolean("clasificadoPorIA").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type InformeCuentaPuc = typeof informesCuentasPuc.$inferSelect;
export type InsertInformeCuentaPuc = typeof informesCuentasPuc.$inferInsert;

/** Catálogo de nombres de cuenta PROPIO de cada cliente — a diferencia de
 * `informesCuentasPuc` (genérico, clasificado por IA, compartido entre
 * todos los clientes), esto es el nombre real que ESE cliente le da a esa
 * cuenta en su propia contabilidad. Se llena solo, automáticamente, cuando
 * el libro auxiliar trae una columna de nombre de cuenta (ej. "Cuenta
 * contable") — y el contador lo puede corregir o completar a mano para
 * clientes cuyo archivo nunca trae nombre. Tiene prioridad sobre el
 * catálogo genérico de IA al armar los reportes. */
export const informesCuentasCliente = mysqlTable("informesCuentasCliente", {
  id: int("id").autoincrement().primaryKey(),
  clienteId: int("clienteId").notNull(),
  cuenta: varchar("cuenta", { length: 12 }).notNull(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  origen: mysqlEnum("origen", ["archivo", "manual"]).default("archivo").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => ({
  clienteCuentaIdx: uniqueIndex("informesCuentasCliente_cliente_cuenta_idx").on(table.clienteId, table.cuenta),
}));
export type InformeCuentaCliente = typeof informesCuentasCliente.$inferSelect;
export type InsertInformeCuentaCliente = typeof informesCuentasCliente.$inferInsert;

/** Una fila por archivo de libro auxiliar/movimiento cargado (un
 * cliente + mes). */
export const informesCargas = mysqlTable("informesCargas", {
  id: int("id").autoincrement().primaryKey(),
  clienteId: int("clienteId").notNull(),
  anio: int("anio").notNull(),
  mes: int("mes").notNull(), // 1-12
  nombreArchivo: varchar("nombreArchivo", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 500 }),
  totalFilas: int("totalFilas"),
  estado: mysqlEnum("estado", ["procesando", "completado", "error"]).default("procesando").notNull(),
  mensajeError: text("mensajeError"),
  cargadoPorId: int("cargadoPorId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  clienteAnioMesIdx: index("informesCargas_cliente_anioMes_idx").on(table.clienteId, table.anio, table.mes),
}));
export type InformeCarga = typeof informesCargas.$inferSelect;
export type InsertInformeCarga = typeof informesCargas.$inferInsert;

/** Saldos agregados por cliente + mes + centro de costo + cuenta, a
 * detalle completo (código de cuenta tal cual viene en el libro
 * auxiliar, sin truncar a 4 dígitos). Esta es la tabla histórica que
 * alimenta TODOS los informes derivados: cada carga mensual upsertea
 * sus filas aquí, así el ERM, el ERI por centro, el punto de
 * equilibrio y el pareto se calculan sobre lo ya cargado, sin
 * reprocesar los archivos crudos.
 * Para clientes sin centro de costo, centroCodigo queda "SC" siempre
 * (no afecta al ERM, que suma todos los centros).
 * La agregación a nivel de 4 dígitos (ej. 5105) para vistas resumidas
 * se hace en tiempo de reporte (LEFT(cuenta, 4)), no al guardar. */
export const informesSaldosMensuales = mysqlTable("informesSaldosMensuales", {
  id: int("id").autoincrement().primaryKey(),
  cargaId: int("cargaId").notNull(),
  clienteId: int("clienteId").notNull(),
  anio: int("anio").notNull(),
  mes: int("mes").notNull(),
  centroCodigo: varchar("centroCodigo", { length: 4 }).notNull(),
  cuenta: varchar("cuenta", { length: 12 }).notNull(),
  tipo: mysqlEnum("tipo", ["ingreso", "costo", "gasto", "descuento_pp"]).notNull(),
  valor: double("valor").notNull(),
}, (table) => ({
  periodoCentroCuentaIdx: uniqueIndex("informesSaldos_periodo_centro_cuenta_idx")
    .on(table.clienteId, table.anio, table.mes, table.centroCodigo, table.cuenta),
  clienteAnioIdx: index("informesSaldos_cliente_anio_idx").on(table.clienteId, table.anio),
}));
export type InformeSaldoMensual = typeof informesSaldosMensuales.$inferSelect;
export type InsertInformeSaldoMensual = typeof informesSaldosMensuales.$inferInsert;

/** Un registro por reporte generado (para historial/descarga posterior).
 * tipo: "ERM" = Estado de Resultados Mensual comparativo (el principal,
 * por cliente, todo el año); "ERI" = por centro de costo (derivado). */
export const informesReportes = mysqlTable("informesReportes", {
  id: int("id").autoincrement().primaryKey(),
  clienteId: int("clienteId").notNull(),
  anio: int("anio").notNull(),
  mes: int("mes"), // null en reportes anuales como el ERM
  tipo: varchar("tipo", { length: 40 }).default("ERM").notNull(),
  nivel: mysqlEnum("nivel", ["resumen", "detalle"]).default("resumen").notNull(),
  fileKey: varchar("fileKey", { length: 500 }).notNull(),
  generadoPorId: int("generadoPorId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  clienteAnioIdx: index("informesReportes_cliente_anio_idx").on(table.clienteId, table.anio),
}));
export type InformeReporte = typeof informesReportes.$inferSelect;
export type InsertInformeReporte = typeof informesReportes.$inferInsert;

/**
 * ============================================================
 * TABLERO — mensajes generales para todo el equipo (no atados a una
 * tarea o cliente puntual): aclaraciones de proceso, documentos para
 * estudio, avisos. Cualquier usuario puede publicar y comentar; queda
 * el historial completo. Cada publicación se etiqueta como "General"
 * (obligacionId null) o con una obligación tributaria específica (ej.
 * IVA), para poder filtrar después "qué se ha dicho de IVA".
 * Los comentarios de cada publicación reutilizan la tabla `comments`
 * genérica (entityType="board_post"), igual que tareas y vencimientos.
 * ============================================================
 */
export const boardPosts = mysqlTable("boardPosts", {
  id: int("id").autoincrement().primaryKey(),
  authorId: int("authorId").notNull(),
  content: text("content").notNull(),
  /** null = "General"; si no, referencia a una obligación tributaria
   * (IVA, Renta, ICA, etc.) para poder filtrar el tablero por tema. */
  obligationId: int("obligationId"),
  pinned: boolean("pinned").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  obligationIdx: index("boardPosts_obligation_idx").on(table.obligationId),
}));
export type BoardPost = typeof boardPosts.$inferSelect;
export type InsertBoardPost = typeof boardPosts.$inferInsert;

/** Documentos adjuntos a una publicación del tablero (ej. un PDF de IVA
 * para lectura) — mismo patrón que taskAttachments. */
export const boardAttachments = mysqlTable("boardAttachments", {
  id: int("id").autoincrement().primaryKey(),
  postId: int("postId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileKey: varchar("fileKey", { length: 255 }).notNull(),
  contentType: varchar("contentType", { length: 100 }),
  fileSize: int("fileSize"),
  uploadedById: int("uploadedById").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type BoardAttachment = typeof boardAttachments.$inferSelect;
export type InsertBoardAttachment = typeof boardAttachments.$inferInsert;

// ==================== RENTA PERSONA NATURAL (módulo separado) ====================
// Clientes propios de este módulo — separados de los clientes generales
// (`clients`). Solo nombre + cédula; el vencimiento se calcula en vivo
// contra el calendario ya cargado en Configuración (dianCalendar), por
// últimos dígitos de cédula, no se guarda una fecha fija aquí.

export const rentaClientes = mysqlTable("rentaClientes", {
  id: int("id").autoincrement().primaryKey(),
  nombre: varchar("nombre", { length: 255 }).notNull(),
  cedula: varchar("cedula", { length: 20 }).notNull(),
  /** Año gravable que se está declarando (ej. 2025, se declara en 2026). */
  anioGravable: int("anioGravable").notNull(),
  /** Marcado cuando se revisó y NO está obligado a declarar — se ubica al
   * final del listado en vez de ordenarse por vencimiento. */
  noObligado: boolean("noObligado").default(false).notNull(),
  /** Se pone en true cuando en la pestaña de liquidación se sube el
   * Formulario 210 con el sello de "recibido" — la renta queda finalizada. */
  terminado: boolean("terminado").default(false).notNull(),
  createdById: int("createdById"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  cedulaAnioIdx: uniqueIndex("rentaClientes_cedula_anio_idx").on(table.cedula, table.anioGravable),
}));
export type RentaCliente = typeof rentaClientes.$inferSelect;
export type InsertRentaCliente = typeof rentaClientes.$inferInsert;

