import { eq, and, desc, asc, like, sql, inArray, gte, lte, or, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import { InsertUser, users, clients, InsertClient, taxObligations, InsertTaxObligation, clientObligations, InsertClientObligation, taxDeadlines, InsertTaxDeadline, tasks, InsertTask, taskAttachments, InsertTaskAttachment, deadlineAttachments, InsertDeadlineAttachment, appSettings, InsertAppSetting, dianCalendar, InsertDianCalendar, clientDriveSubfolders } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ==================== USERS ====================

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByUsername(username: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).orderBy(asc(users.name));
}

export async function getActiveUsers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateUser(id: number, data: Partial<InsertUser>) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set(data).where(eq(users.id, id));
}

export async function deactivateUser(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ isActive: false }).where(eq(users.id, id));
}

export async function activateUser(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ isActive: true }).where(eq(users.id, id));
}

export async function createCollaborator(data: { name: string; email?: string; role: string; phone?: string; position?: string; username: string; passwordHash: string; cedula?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { nanoid } = await import("nanoid");
  const openId = `local_${nanoid()}`;
  const result = await db.insert(users).values({
    openId,
    name: data.name,
    email: data.email || null,
    username: data.username,
    passwordHash: data.passwordHash,
    cedula: data.cedula || null,
    role: data.role as any,
    phone: data.phone || null,
    position: data.position || null,
    isActive: true,
    loginMethod: "local",
  });
  return result[0].insertId;
}

export async function updateUserPassword(id: number, passwordHash: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ passwordHash }).where(eq(users.id, id));
}

export async function findInvitedUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(users)
    .where(and(eq(users.email, email), like(users.openId, 'invited_%')))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function claimInvitedUser(id: number, data: { openId: string; name: string | null; loginMethod: string | null; lastSignedIn: Date }) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({
    openId: data.openId,
    name: data.name,
    loginMethod: data.loginMethod,
    lastSignedIn: data.lastSignedIn,
  }).where(eq(users.id, id));
}

export async function getUsersByFilters(filters: { role?: string; isActive?: boolean }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.role) conditions.push(eq(users.role, filters.role as any));
  if (filters.isActive !== undefined) conditions.push(eq(users.isActive, filters.isActive));
  if (conditions.length === 0) return db.select().from(users).orderBy(asc(users.name));
  return db.select().from(users).where(and(...conditions)).orderBy(asc(users.name));
}

// ==================== CLIENTS ====================

export async function createClient(data: InsertClient) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(clients).values(data);
  return result[0].insertId;
}

export async function getAllClients(managerId?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions = managerId
    ? and(eq(clients.isActive, true), eq(clients.managerId, managerId))
    : eq(clients.isActive, true);
  return db.select({
    id: clients.id,
    razonSocial: clients.razonSocial,
    nit: clients.nit,
    digitoVerificacion: clients.digitoVerificacion,
    direccion: clients.direccion,
    ciudad: clients.ciudad,
    departamento: clients.departamento,
    telefono: clients.telefono,
    email: clients.email,
    actividadEconomica: clients.actividadEconomica,
    codigoCIIU: clients.codigoCIIU,
    representanteLegal: clients.representanteLegal,
    rutFileUrl: clients.rutFileUrl,
    rutFileKey: clients.rutFileKey,
    managerId: clients.managerId,
    managerName: users.name,
    driveFolderUrl: clients.driveFolderUrl,
    isActive: clients.isActive,
    notes: clients.notes,
    createdById: clients.createdById,
    createdAt: clients.createdAt,
    updatedAt: clients.updatedAt,
  })
    .from(clients)
    .leftJoin(users, eq(clients.managerId, users.id))
    .where(conditions)
    .orderBy(asc(clients.razonSocial));
}

export async function getClientById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateClient(id: number, data: Partial<InsertClient>) {
  const db = await getDb();
  if (!db) return;
  await db.update(clients).set(data).where(eq(clients.id, id));
}

export async function deactivateClient(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(clients).set({ isActive: false }).where(eq(clients.id, id));
}

// ==================== TAX OBLIGATIONS ====================

export async function getAllTaxObligations() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(taxObligations).where(eq(taxObligations.isActive, true)).orderBy(asc(taxObligations.name));
}

/** For the admin management screen: includes inactive obligations too */
export async function getAllTaxObligationsForAdmin() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(taxObligations).orderBy(asc(taxObligations.name));
}

export async function createTaxObligation(data: InsertTaxObligation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(taxObligations).values(data);
  return result[0].insertId;
}

export async function updateTaxObligation(id: number, data: Partial<InsertTaxObligation>) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxObligations).set(data).where(eq(taxObligations.id, id));
}

export async function setTaxObligationActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxObligations).set({ isActive }).where(eq(taxObligations.id, id));
  if (!isActive) {
    // Remove deadlines for this obligation that were never started (no
    // supporting evidence attached yet) — keep anything that already has a
    // response/file so nothing with real work on it silently disappears.
    await db.delete(taxDeadlines).where(
      and(eq(taxDeadlines.obligationId, id), sql`${taxDeadlines.evidenceFileUrl} IS NULL`)
    );
  }
}

/** One-off cleanup for obligations that were deactivated before this
 * automatic cleanup existed — removes any still-pending, never-started
 * deadlines (no evidence attached) left over from currently inactive
 * obligations. Safe to run any time; never touches deadlines with evidence. */
export async function cleanupInactiveObligationDeadlines() {
  const db = await getDb();
  if (!db) return 0;
  const inactiveObligations = await db.select({ id: taxObligations.id })
    .from(taxObligations)
    .where(eq(taxObligations.isActive, false));
  if (inactiveObligations.length === 0) return 0;
  const ids = inactiveObligations.map(o => o.id);
  const result = await db.delete(taxDeadlines).where(
    and(inArray(taxDeadlines.obligationId, ids), sql`${taxDeadlines.evidenceFileUrl} IS NULL`)
  );
  return (result as any)[0]?.affectedRows ?? 0;
}

export async function getClientObligations(clientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: clientObligations.id,
    clientId: clientObligations.clientId,
    obligationId: clientObligations.obligationId,
    obligationName: taxObligations.name,
    obligationCode: taxObligations.code,
    frequency: taxObligations.frequency,
    installments: taxObligations.installments,
    fixedDueDates: taxObligations.fixedDueDates,
  })
    .from(clientObligations)
    .innerJoin(taxObligations, eq(clientObligations.obligationId, taxObligations.id))
    .where(eq(clientObligations.clientId, clientId));
}

export async function setClientObligations(clientId: number, obligationIds: number[]) {
  const db = await getDb();
  if (!db) return;
  await db.delete(clientObligations).where(eq(clientObligations.clientId, clientId));
  if (obligationIds.length > 0) {
    const values = obligationIds.map(obligationId => ({ clientId, obligationId }));
    await db.insert(clientObligations).values(values);
  }
}

// ==================== TAX DEADLINES ====================

export async function createTaxDeadlines(deadlines: InsertTaxDeadline[]) {
  const db = await getDb();
  if (!db) return;
  if (deadlines.length === 0) return;
  await db.insert(taxDeadlines).values(deadlines);
}

export async function getClientDeadlines(clientId: number) {
  const db = await getDb();
  if (!db) return [];
  const reviewedByUser = alias(users, "reviewedByUser");
  return db.select({
    id: taxDeadlines.id,
    clientId: taxDeadlines.clientId,
    obligationId: taxDeadlines.obligationId,
    obligationName: taxObligations.name,
    obligationCode: taxObligations.code,
    period: taxDeadlines.period,
    dueDate: taxDeadlines.dueDate,
    lastDigitNit: taxDeadlines.lastDigitNit,
    status: taxDeadlines.status,
    completedAt: taxDeadlines.completedAt,
    completedById: taxDeadlines.completedById,
    completedByName: users.name,
    evidenceFileUrl: taxDeadlines.evidenceFileUrl,
    evidenceFileKey: taxDeadlines.evidenceFileKey,
    driveSubfolder: taxDeadlines.driveSubfolder,
    reviewNotes: taxDeadlines.reviewNotes,
    reviewedAt: taxDeadlines.reviewedAt,
    reviewedByName: reviewedByUser.name,
    clientDriveFolderUrl: clients.driveFolderUrl,
    notes: taxDeadlines.notes,
    createdAt: taxDeadlines.createdAt,
  })
    .from(taxDeadlines)
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .innerJoin(clients, eq(taxDeadlines.clientId, clients.id))
    .leftJoin(users, eq(taxDeadlines.completedById, users.id))
    .leftJoin(reviewedByUser, eq(taxDeadlines.reviewedById, reviewedByUser.id))
    .where(eq(taxDeadlines.clientId, clientId))
    .orderBy(asc(taxDeadlines.dueDate));
}

export async function getUpcomingDeadlines(daysAhead: number = 30, managerId?: number) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);
  const baseConditions = and(
    inArray(taxDeadlines.status, ["pendiente", "en_progreso"]),
    gte(taxDeadlines.dueDate, now),
    lte(taxDeadlines.dueDate, future),
  );
  return db.select({
    id: taxDeadlines.id,
    clientId: taxDeadlines.clientId,
    clientName: clients.razonSocial,
    clientNit: clients.nit,
    obligationId: taxDeadlines.obligationId,
    obligationName: taxObligations.name,
    period: taxDeadlines.period,
    dueDate: taxDeadlines.dueDate,
    status: taxDeadlines.status,
  })
    .from(taxDeadlines)
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .innerJoin(clients, eq(taxDeadlines.clientId, clients.id))
    .where(managerId ? and(baseConditions, eq(clients.managerId, managerId)) : baseConditions)
    .orderBy(asc(taxDeadlines.dueDate));
}

export async function getDeadlinesForMonth(year: number, month: number, managerId?: number) {
  const db = await getDb();
  if (!db) return [];
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const conditions = [
    gte(taxDeadlines.dueDate, startDate),
    lte(taxDeadlines.dueDate, endDate),
  ];
  if (managerId) conditions.push(eq(clients.managerId, managerId));
  return db.select({
    id: taxDeadlines.id,
    clientId: taxDeadlines.clientId,
    clientName: clients.razonSocial,
    clientNit: clients.nit,
    obligationId: taxDeadlines.obligationId,
    obligationName: taxObligations.name,
    period: taxDeadlines.period,
    dueDate: taxDeadlines.dueDate,
    status: taxDeadlines.status,
  })
    .from(taxDeadlines)
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .innerJoin(clients, eq(taxDeadlines.clientId, clients.id))
    .where(and(...conditions))
    .orderBy(asc(taxDeadlines.dueDate));
}

export async function updateDeadlineStatus(id: number, status: "pendiente" | "en_progreso" | "vencido", completedById?: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxDeadlines).set({ status }).where(eq(taxDeadlines.id, id));
}

/** Marks a deadline as completed with required supporting evidence. */
export async function completeDeadline(id: number, evidenceFileUrl: string, evidenceFileKey: string | null, completedById: number, driveSubfolder?: string | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxDeadlines).set({
    status: "completado",
    completedAt: new Date(),
    completedById,
    evidenceFileUrl,
    evidenceFileKey,
    driveSubfolder: driveSubfolder || null,
  }).where(eq(taxDeadlines.id, id));
}

/** Known subfolder names (inside the client's single Drive folder link) that
 * collaborators have used before for this client — offered as a dropdown so
 * people pick a consistent existing name instead of retyping it slightly
 * differently each time. */
export async function getClientDriveSubfolders(clientId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clientDriveSubfolders)
    .where(eq(clientDriveSubfolders.clientId, clientId))
    .orderBy(asc(clientDriveSubfolders.name));
}

/** Remembers a subfolder name for this client, if it isn't already known. */
export async function ensureClientDriveSubfolder(clientId: number, name: string) {
  const db = await getDb();
  if (!db) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const existing = await db.select().from(clientDriveSubfolders)
    .where(and(eq(clientDriveSubfolders.clientId, clientId), eq(clientDriveSubfolders.name, trimmed)))
    .limit(1);
  if (existing.length === 0) {
    await db.insert(clientDriveSubfolders).values({ clientId, name: trimmed });
  }
}

/** Admin-only: reopens a deadline that was mistakenly marked completed. */
export async function reopenDeadline(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(deadlineAttachments).where(eq(deadlineAttachments.deadlineId, id));
  await db.update(taxDeadlines).set({
    status: "pendiente",
    completedAt: null,
    completedById: null,
    evidenceFileUrl: null,
    evidenceFileKey: null,
    driveSubfolder: null,
  }).where(eq(taxDeadlines.id, id));
}

/** Manually correct a single deadline's due date, e.g. when the auto-generated
 * or DIAN-imported date turns out to be wrong for that specific client/period. */
export async function updateDeadlineDueDate(id: number, dueDate: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxDeadlines).set({ dueDate }).where(eq(taxDeadlines.id, id));
}

export async function deleteClientDeadlines(clientId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(taxDeadlines).where(eq(taxDeadlines.clientId, clientId));
}

// ==================== TASKS ====================

export async function createTask(data: InsertTask) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(tasks).values(data);
  return result[0].insertId;
}

export async function getAllTasks(assignedToId?: number) {
  const db = await getDb();
  if (!db) return [];
  const completedByUser = alias(users, "completedByUser");
  const reviewedByUser = alias(users, "reviewedByUser");
  const query = db.select({
    id: tasks.id,
    title: tasks.title,
    description: tasks.description,
    clientId: tasks.clientId,
    clientName: clients.razonSocial,
    clientDriveFolderUrl: clients.driveFolderUrl,
    assignedToId: tasks.assignedToId,
    assignedToName: users.name,
    createdById: tasks.createdById,
    dueDate: tasks.dueDate,
    status: tasks.status,
    priority: tasks.priority,
    isAutoGenerated: tasks.isAutoGenerated,
    taxDeadlineId: tasks.taxDeadlineId,
    completedAt: tasks.completedAt,
    completedById: tasks.completedById,
    completedByName: completedByUser.name,
    evidenceFileUrl: tasks.evidenceFileUrl,
    evidenceFileKey: tasks.evidenceFileKey,
    driveSubfolder: tasks.driveSubfolder,
    completionNotes: tasks.completionNotes,
    reviewNotes: tasks.reviewNotes,
    reviewedAt: tasks.reviewedAt,
    reviewedByName: reviewedByUser.name,
    createdAt: tasks.createdAt,
  })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .leftJoin(completedByUser, eq(tasks.completedById, completedByUser.id))
    .leftJoin(reviewedByUser, eq(tasks.reviewedById, reviewedByUser.id));

  // Non-admins only see tasks assigned directly to them — not every task for
  // clients they happen to manage (that broader scope is for deadlines,
  // where the manager is responsible for ALL of a client's obligations;
  // tasks have their own individual assignee).
  if (assignedToId) {
    return query.where(eq(tasks.assignedToId, assignedToId)).orderBy(desc(tasks.createdAt));
  }
  return query.orderBy(desc(tasks.createdAt));
}

export async function getTasksByAssignee(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: tasks.id,
    title: tasks.title,
    description: tasks.description,
    clientId: tasks.clientId,
    clientName: clients.razonSocial,
    assignedToId: tasks.assignedToId,
    dueDate: tasks.dueDate,
    status: tasks.status,
    priority: tasks.priority,
    isAutoGenerated: tasks.isAutoGenerated,
    completedAt: tasks.completedAt,
    createdAt: tasks.createdAt,
  })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .where(eq(tasks.assignedToId, userId))
    .orderBy(desc(tasks.createdAt));
}

export async function getTaskById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateTask(id: number, data: Partial<InsertTask>) {
  const db = await getDb();
  if (!db) return;
  await db.update(tasks).set(data).where(eq(tasks.id, id));
}

/** Admin reviews and approves a completed task, optionally leaving
 * observations/instructions for the collaborator to see. */
export async function approveTask(id: number, reviewedById: number, reviewNotes?: string | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(tasks).set({
    reviewedById,
    reviewedAt: new Date(),
    reviewNotes: reviewNotes || null,
  }).where(eq(tasks.id, id));
}

export async function approveDeadline(id: number, reviewedById: number, reviewNotes?: string | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxDeadlines).set({
    reviewedById,
    reviewedAt: new Date(),
    reviewNotes: reviewNotes || null,
  }).where(eq(taxDeadlines.id, id));
}

/** Admin cancels a task that's no longer needed. If nothing was ever
 * attached to it, it's just removed outright — there's no work to preserve.
 * If evidence/a response was already attached, it's kept for the record but
 * marked "cancelada" so it stops counting as active work on the dashboard. */
export async function cancelTask(id: number): Promise<"deleted" | "cancelled"> {
  const db = await getDb();
  if (!db) return "deleted";
  const task = await getTaskById(id);
  if (!task) return "deleted";

  if (!task.evidenceFileUrl) {
    await db.delete(tasks).where(eq(tasks.id, id));
    return "deleted";
  }

  await db.update(tasks).set({ status: "cancelada" }).where(eq(tasks.id, id));
  return "cancelled";
}

// Local date key ("YYYY-MM-DD") — avoids UTC-shift bugs from toISOString()
// when the server and the accounting firm are in different timezones.
function localDateKey(d: Date): string {
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${yr}-${mo}-${da}`;
}

export type DashboardFilters = {
  month: string; // "YYYY-MM"
  clientId?: number;
  assignedToId?: number;
  obligationId?: number;
  managerId?: number; // role-scoping for non-admins: only their managed clients
};

export type ReviewFilters = {
  month?: string; // "YYYY-MM", omit for all-time
  clientId?: number;
  assignedToId?: number;
  obligationId?: number;
  managerId?: number; // role-scoping for non-admins
};

/** Completed tasks + completed deadlines across ALL clients, for the admin
 * "Revisión" screen — lets an admin browse everything that's been marked
 * done and drill into each one's evidence/attachments. */
export async function getCompletedItemsForReview(filters: ReviewFilters) {
  const db = await getDb();
  if (!db) return [] as any[];

  let monthRange: { start: Date; end: Date } | null = null;
  if (filters.month) {
    const [yearStr, monthStr] = filters.month.split("-");
    const year = parseInt(yearStr);
    const monthIdx = parseInt(monthStr) - 1;
    monthRange = {
      start: new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0)),
      end: new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59)),
    };
  }

  const completedByUser = alias(users, "completedByUser");
  const reviewedByUser = alias(users, "reviewedByUser");

  // ---- Completed tasks ----
  const taskConditions = [eq(tasks.status, "completada")];
  if (monthRange) taskConditions.push(gte(tasks.completedAt, monthRange.start), lte(tasks.completedAt, monthRange.end));
  if (filters.clientId) taskConditions.push(eq(tasks.clientId, filters.clientId));
  if (filters.assignedToId) taskConditions.push(eq(tasks.assignedToId, filters.assignedToId));
  if (filters.managerId) taskConditions.push(eq(clients.managerId, filters.managerId));
  if (filters.obligationId) taskConditions.push(eq(taxDeadlines.obligationId, filters.obligationId));

  const completedTasks = await db.select({
    id: tasks.id,
    title: tasks.title,
    clientId: tasks.clientId,
    clientName: clients.razonSocial,
    assignedToName: users.name,
    completedAt: tasks.completedAt,
    completedByName: completedByUser.name,
    completionNotes: tasks.completionNotes,
    driveSubfolder: tasks.driveSubfolder,
    clientDriveFolderUrl: clients.driveFolderUrl,
    reviewNotes: tasks.reviewNotes,
    reviewedAt: tasks.reviewedAt,
    reviewedByName: reviewedByUser.name,
  })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .leftJoin(completedByUser, eq(tasks.completedById, completedByUser.id))
    .leftJoin(reviewedByUser, eq(tasks.reviewedById, reviewedByUser.id))
    .leftJoin(taxDeadlines, eq(tasks.taxDeadlineId, taxDeadlines.id))
    .where(and(...taskConditions))
    .orderBy(desc(tasks.completedAt));

  // ---- Completed deadlines ----
  const deadlineConditions = [eq(taxDeadlines.status, "completado")];
  if (monthRange) deadlineConditions.push(gte(taxDeadlines.completedAt, monthRange.start), lte(taxDeadlines.completedAt, monthRange.end));
  if (filters.clientId) deadlineConditions.push(eq(taxDeadlines.clientId, filters.clientId));
  if (filters.obligationId) deadlineConditions.push(eq(taxDeadlines.obligationId, filters.obligationId));
  if (filters.managerId) deadlineConditions.push(eq(clients.managerId, filters.managerId));
  if (filters.assignedToId) deadlineConditions.push(eq(clients.managerId, filters.assignedToId));

  const completedDeadlines = await db.select({
    id: taxDeadlines.id,
    clientId: taxDeadlines.clientId,
    clientName: clients.razonSocial,
    obligationName: taxObligations.name,
    period: taxDeadlines.period,
    completedAt: taxDeadlines.completedAt,
    completedByName: users.name,
    driveSubfolder: taxDeadlines.driveSubfolder,
    clientDriveFolderUrl: clients.driveFolderUrl,
    reviewNotesRaw: taxDeadlines.reviewNotes,
    reviewedAtRaw: taxDeadlines.reviewedAt,
    reviewedByNameRaw: reviewedByUser.name,
  })
    .from(taxDeadlines)
    .innerJoin(clients, eq(taxDeadlines.clientId, clients.id))
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .leftJoin(users, eq(taxDeadlines.completedById, users.id))
    .leftJoin(reviewedByUser, eq(taxDeadlines.reviewedById, reviewedByUser.id))
    .where(and(...deadlineConditions))
    .orderBy(desc(taxDeadlines.completedAt));

  const combined = [
    ...completedTasks.map(t => ({
      itemType: "task" as const,
      id: t.id,
      title: t.title,
      clientId: t.clientId,
      clientName: t.clientName,
      subtitle: t.assignedToName ? `Asignada a ${t.assignedToName}` : "Sin asignar",
      completedAt: t.completedAt,
      completedByName: t.completedByName,
      completionNotes: t.completionNotes,
      driveSubfolder: t.driveSubfolder,
      clientDriveFolderUrl: t.clientDriveFolderUrl,
      reviewNotes: t.reviewNotes,
      reviewedAt: t.reviewedAt,
      reviewedByName: t.reviewedByName,
    })),
    ...completedDeadlines.map(d => ({
      itemType: "deadline" as const,
      id: d.id,
      title: d.obligationName,
      clientId: d.clientId,
      clientName: d.clientName,
      subtitle: `Período ${d.period}`,
      completedAt: d.completedAt,
      completedByName: d.completedByName,
      completionNotes: null as string | null,
      driveSubfolder: d.driveSubfolder,
      clientDriveFolderUrl: d.clientDriveFolderUrl,
      reviewNotes: d.reviewNotesRaw,
      reviewedAt: d.reviewedAtRaw,
      reviewedByName: d.reviewedByNameRaw,
    })),
  ];

  // Approved items sink to the bottom — the reviewer cares most about what
  // still needs a look; already-approved work is done business, kept at
  // hand for reference but out of the way.
  combined.sort((a, b) => {
    const aApproved = a.reviewedAt ? 1 : 0;
    const bApproved = b.reviewedAt ? 1 : 0;
    if (aApproved !== bApproved) return aApproved - bApproved;
    const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bTime - aTime;
  });

  return combined;
}

export async function getDashboardData(filters: DashboardFilters) {
  const db = await getDb();
  const empty = {
    taskStats: { pendiente: 0, en_progreso: 0, completada: 0, vencida: 0 },
    tasksByStatus: { pendiente: [], en_progreso: [], completada: [], vencida: [] },
    upcomingItems: [] as any[],
    workload: [] as any[],
    heatmap: [] as { date: string; count: number; items: { clientName: string; title: string }[] }[],
  };
  if (!db) return empty;

  const [yearStr, monthStr] = filters.month.split("-");
  const year = parseInt(yearStr);
  const monthIdx = parseInt(monthStr) - 1; // 0-based
  const monthStart = new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0));
  const monthEnd = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59));

  // ---- Tasks due within the selected month ----
  const taskConditions = [gte(tasks.dueDate, monthStart), lte(tasks.dueDate, monthEnd), ne(tasks.status, "cancelada")];
  if (filters.clientId) taskConditions.push(eq(tasks.clientId, filters.clientId));
  if (filters.assignedToId) taskConditions.push(eq(tasks.assignedToId, filters.assignedToId));
  // Non-admin role-scoping for tasks uses their own assignedToId (their
  // tasks are their own, unlike deadlines which follow the client's manager).
  if (filters.managerId) taskConditions.push(eq(tasks.assignedToId, filters.managerId));
  if (filters.obligationId) taskConditions.push(eq(taxDeadlines.obligationId, filters.obligationId));

  const taskRows = await db.select({
    id: tasks.id,
    title: tasks.title,
    clientId: tasks.clientId,
    clientName: clients.razonSocial,
    assignedToId: tasks.assignedToId,
    assignedToName: users.name,
    dueDate: tasks.dueDate,
    status: tasks.status,
    priority: tasks.priority,
  })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .leftJoin(taxDeadlines, eq(tasks.taxDeadlineId, taxDeadlines.id))
    .where(and(...taskConditions))
    .orderBy(asc(tasks.dueDate));

  // ---- Tax deadlines due within the selected month ----
  const deadlineConditions = [gte(taxDeadlines.dueDate, monthStart), lte(taxDeadlines.dueDate, monthEnd)];
  if (filters.clientId) deadlineConditions.push(eq(taxDeadlines.clientId, filters.clientId));
  if (filters.obligationId) deadlineConditions.push(eq(taxDeadlines.obligationId, filters.obligationId));
  if (filters.managerId) deadlineConditions.push(eq(clients.managerId, filters.managerId));
  // Deadlines don't have their own assignee — the client's manager is
  // responsible for all of that client's tax obligations, so the "Encargado"
  // filter scopes deadlines by managerId, while it scopes tasks by their own
  // individual assignedToId (set below in taskConditions).
  if (filters.assignedToId) deadlineConditions.push(eq(clients.managerId, filters.assignedToId));

  const deadlineRows = await db.select({
    id: taxDeadlines.id,
    clientId: taxDeadlines.clientId,
    clientName: clients.razonSocial,
    obligationId: taxDeadlines.obligationId,
    obligationName: taxObligations.name,
    period: taxDeadlines.period,
    dueDate: taxDeadlines.dueDate,
    status: taxDeadlines.status,
  })
    .from(taxDeadlines)
    .innerJoin(clients, eq(taxDeadlines.clientId, clients.id))
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .where(and(...deadlineConditions))
    .orderBy(asc(taxDeadlines.dueDate));

  // ---- KPI counts + tasks grouped by status (for the "recent tasks" columns) ----
  const taskStats = { pendiente: 0, en_progreso: 0, completada: 0, vencida: 0 };
  const tasksByStatus: Record<string, any[]> = { pendiente: [], en_progreso: [], completada: [], vencida: [] };
  for (const t of taskRows) {
    if (t.status in taskStats) {
      taskStats[t.status as keyof typeof taskStats]++;
      if (tasksByStatus[t.status].length < 8) tasksByStatus[t.status].push(t);
    }
  }

  // ---- Combined, sorted "upcoming this month" list (tasks + deadlines) ----
  const upcomingItems = [
    ...taskRows
      .filter(t => t.dueDate && t.status !== "completada")
      .map(t => ({
        id: `t-${t.id}`,
        type: "task" as const,
        title: t.title,
        subtitle: `${t.clientName || "Sin cliente"} → ${t.assignedToName || "Sin asignar"}`,
        date: t.dueDate as Date,
      })),
    ...deadlineRows
      .filter(d => d.status === "pendiente" || d.status === "en_progreso")
      .map(d => ({
        id: `d-${d.id}`,
        type: "deadline" as const,
        title: d.obligationName,
        subtitle: `${d.clientName} — ${d.period}`,
        date: d.dueDate,
      })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // ---- Heatmap: how many tasks+deadlines are due each day of the month,
  // plus a short summary of which clients/items for the tooltip ----
  const heatmapMap = new Map<string, { count: number; items: { clientName: string; title: string }[] }>();
  const addToHeatmap = (key: string, clientName: string, title: string) => {
    if (!heatmapMap.has(key)) heatmapMap.set(key, { count: 0, items: [] });
    const entry = heatmapMap.get(key)!;
    entry.count++;
    if (entry.items.length < 12) entry.items.push({ clientName, title });
  };
  for (const t of taskRows) {
    if (!t.dueDate) continue;
    addToHeatmap(localDateKey(new Date(t.dueDate)), t.clientName || "Sin cliente", t.title);
  }
  for (const d of deadlineRows) {
    addToHeatmap(localDateKey(new Date(d.dueDate)), d.clientName, d.obligationName);
  }
  const heatmap = Array.from(heatmapMap.entries()).map(([date, { count, items }]) => ({ date, count, items }));

  // ---- Workload by collaborator — company-wide view, admin only ----
  // Start from EVERY active collaborator (not just ones who already have a
  // task this month), so someone with zero tasks still shows up with 0/0
  // instead of silently disappearing from the list.
  let workload: any[] = [];
  if (!filters.managerId) {
    const activeUsers = await db.select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.isActive, true));

    const workloadMap = new Map<number, { userId: number; userName: string; totalTasks: number; pendingTasks: number; inProgressTasks: number; completedTasks: number }>();
    for (const u of activeUsers) {
      workloadMap.set(u.id, {
        userId: u.id,
        userName: u.name,
        totalTasks: 0,
        pendingTasks: 0,
        inProgressTasks: 0,
        completedTasks: 0,
      });
    }
    for (const t of taskRows) {
      if (!t.assignedToId) continue;
      if (!workloadMap.has(t.assignedToId)) {
        workloadMap.set(t.assignedToId, {
          userId: t.assignedToId,
          userName: t.assignedToName || "Sin asignar",
          totalTasks: 0,
          pendingTasks: 0,
          inProgressTasks: 0,
          completedTasks: 0,
        });
      }
      const w = workloadMap.get(t.assignedToId)!;
      w.totalTasks++;
      if (t.status === "pendiente") w.pendingTasks++;
      if (t.status === "en_progreso") w.inProgressTasks++;
      if (t.status === "completada") w.completedTasks++;
    }
    workload = Array.from(workloadMap.values());
  }

  return {
    taskStats,
    tasksByStatus,
    upcomingItems: upcomingItems.slice(0, 15),
    workload,
    heatmap,
  };
}

export async function getTaskStats() {
  const db = await getDb();
  if (!db) return { pendiente: 0, en_progreso: 0, completada: 0, vencida: 0 };
  const result = await db.select({
    status: tasks.status,
    count: sql<number>`count(*)`,
  }).from(tasks).groupBy(tasks.status);
  
  const stats = { pendiente: 0, en_progreso: 0, completada: 0, vencida: 0 };
  result.forEach(r => {
    if (r.status in stats) stats[r.status as keyof typeof stats] = Number(r.count);
  });
  return stats;
}

export async function getRecentTasksByStatus(limit: number = 5) {
  const db = await getDb();
  if (!db) return { pendiente: [], en_progreso: [], completada: [], vencida: [] };
  const allTasks = await db.select({
    id: tasks.id,
    title: tasks.title,
    clientId: tasks.clientId,
    clientName: clients.razonSocial,
    assignedToId: tasks.assignedToId,
    assignedToName: users.name,
    dueDate: tasks.dueDate,
    status: tasks.status,
    priority: tasks.priority,
    createdAt: tasks.createdAt,
  })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .orderBy(desc(tasks.createdAt))
    .limit(50);

  const grouped: Record<string, typeof allTasks> = { pendiente: [], en_progreso: [], completada: [], vencida: [] };
  for (const task of allTasks) {
    if (task.status in grouped && grouped[task.status].length < limit) {
      grouped[task.status].push(task);
    }
  }
  return grouped;
}

export async function getWorkloadByUser() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    userId: users.id,
    userName: users.name,
    role: users.role,
    totalTasks: sql<number>`count(${tasks.id})`,
    pendingTasks: sql<number>`sum(case when ${tasks.status} = 'pendiente' then 1 else 0 end)`,
    inProgressTasks: sql<number>`sum(case when ${tasks.status} = 'en_progreso' then 1 else 0 end)`,
    completedTasks: sql<number>`sum(case when ${tasks.status} = 'completada' then 1 else 0 end)`,
  })
    .from(users)
    .leftJoin(tasks, eq(users.id, tasks.assignedToId))
    .where(eq(users.isActive, true))
    .groupBy(users.id, users.name, users.role);
}

// ==================== TASK ATTACHMENTS ====================

export async function createTaskAttachment(data: InsertTaskAttachment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(taskAttachments).values(data);
  return result[0].insertId;
}

export async function createDeadlineAttachment(data: InsertDeadlineAttachment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(deadlineAttachments).values(data);
  return result[0].insertId;
}

export async function getDeadlineAttachments(deadlineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: deadlineAttachments.id,
    deadlineId: deadlineAttachments.deadlineId,
    fileName: deadlineAttachments.fileName,
    fileUrl: deadlineAttachments.fileUrl,
    fileKey: deadlineAttachments.fileKey,
    contentType: deadlineAttachments.contentType,
    fileSize: deadlineAttachments.fileSize,
    uploadedById: deadlineAttachments.uploadedById,
    uploadedByName: users.name,
    createdAt: deadlineAttachments.createdAt,
  })
    .from(deadlineAttachments)
    .leftJoin(users, eq(deadlineAttachments.uploadedById, users.id))
    .where(eq(deadlineAttachments.deadlineId, deadlineId))
    .orderBy(desc(deadlineAttachments.createdAt));
}

export async function clearTaskAttachments(taskId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(taskAttachments).where(and(eq(taskAttachments.taskId, taskId), eq(taskAttachments.isEvidence, true)));
}

export async function getTaskAttachments(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: taskAttachments.id,
    taskId: taskAttachments.taskId,
    fileName: taskAttachments.fileName,
    fileUrl: taskAttachments.fileUrl,
    fileKey: taskAttachments.fileKey,
    contentType: taskAttachments.contentType,
    fileSize: taskAttachments.fileSize,
    uploadedById: taskAttachments.uploadedById,
    uploadedByName: users.name,
    createdAt: taskAttachments.createdAt,
  })
    .from(taskAttachments)
    .leftJoin(users, eq(taskAttachments.uploadedById, users.id))
    .where(eq(taskAttachments.taskId, taskId))
    .orderBy(desc(taskAttachments.createdAt));
}

// ==================== APP SETTINGS ====================

export async function getSetting(key: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function setSetting(key: string, value: string, description?: string, updatedById?: number) {
  const db = await getDb();
  if (!db) return;
  await db.insert(appSettings).values({ key, value, description, updatedById })
    .onDuplicateKeyUpdate({ set: { value, updatedById } });
}

export async function getAllSettings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(appSettings);
}

// ==================== DIAN CALENDAR ====================

export async function getDianCalendarEntries(year: number, obligationCode?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(dianCalendar.year, year)];
  if (obligationCode) conditions.push(eq(dianCalendar.obligationCode, obligationCode));
  return db.select().from(dianCalendar).where(and(...conditions)).orderBy(asc(dianCalendar.dueDate));
}

/** Matches a client's NIT against a DIAN calendar grouping value, which can be:
 * - "ALL": the deadline applies to everyone regardless of NIT (e.g. RUB, informe país por país)
 * - a two-digit range like "01-02": matches clients whose NIT ends in 01 or 02
 *   (used by Renta - Personas Naturales, grouped by the last TWO digits)
 * - a single digit "0"-"9": matches clients whose NIT ends in that digit (most obligations)
 */
export function nitMatchesGroup(nit: string | null | undefined, groupValue: string): boolean {
  if (groupValue === "ALL") return true;
  if (!nit) return false;
  const digits = nit.replace(/\D/g, "");
  if (groupValue.includes("-")) {
    const last2 = digits.slice(-2).padStart(2, "0");
    const parts = groupValue.split("-").map(p => p.padStart(2, "0"));
    return parts.includes(last2);
  }
  return digits.slice(-1) === groupValue;
}

export async function getDianCalendarForDeadline(year: number, obligationCode: string, clientNit: string, period: string) {
  const db = await getDb();
  if (!db) return null;
  const candidates = await db.select().from(dianCalendar)
    .where(and(
      eq(dianCalendar.year, year),
      eq(dianCalendar.obligationCode, obligationCode),
      eq(dianCalendar.period, period),
    ));
  return candidates.find(c => nitMatchesGroup(clientNit, c.lastDigitNit)) || null;
}

export async function clearDianCalendar(year: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(dianCalendar).where(eq(dianCalendar.year, year));
}

export async function insertDianCalendarEntries(entries: InsertDianCalendar[]) {
  const db = await getDb();
  if (!db) return;
  if (entries.length === 0) return;
  // Insert in batches of 100
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    await db.insert(dianCalendar).values(batch);
  }
}

/** Copies calendar entries from one obligation to another for the same year
 * — useful when the DIAN calendar states an obligation shares its exact
 * dates with another (e.g. "Consumo" follows "IVA Bimestral"'s schedule). */
export async function copyDianCalendarEntries(
  year: number,
  fromObligationCode: string,
  toObligationCode: string,
  uploadedById?: number
) {
  const db = await getDb();
  if (!db) return 0;

  const sourceEntries = await db
    .select()
    .from(dianCalendar)
    .where(and(eq(dianCalendar.year, year), eq(dianCalendar.obligationCode, fromObligationCode)));

  if (sourceEntries.length === 0) return 0;

  // Remove any existing entries for the target obligation/year first, so
  // re-running this doesn't create duplicates.
  await db.delete(dianCalendar).where(and(eq(dianCalendar.year, year), eq(dianCalendar.obligationCode, toObligationCode)));

  const copies: InsertDianCalendar[] = sourceEntries.map(e => ({
    year: e.year,
    obligationCode: toObligationCode,
    period: e.period,
    lastDigitNit: e.lastDigitNit,
    dueDate: e.dueDate,
    uploadedById: uploadedById ?? e.uploadedById,
  }));

  await insertDianCalendarEntries(copies);
  return copies.length;
}

// ==================== CLIENTS BY MANAGER ====================

export async function getClientsByManager(managerId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(clients)
    .where(and(eq(clients.managerId, managerId), eq(clients.isActive, true)))
    .orderBy(asc(clients.razonSocial));
}

// ==================== TASKS BY DEADLINE ====================

export async function getTasksByDeadlineId(deadlineId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tasks)
    .where(eq(tasks.taxDeadlineId, deadlineId));
}


