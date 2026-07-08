import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json } from "drizzle-orm/mysql-core";

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
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = typeof taskAttachments.$inferInsert;

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
