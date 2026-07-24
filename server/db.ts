import { eq, and, desc, asc, like, sql, inArray, gte, lte, or, ne, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { alias } from "drizzle-orm/mysql-core";
import { InsertUser, users, clients, InsertClient, taxObligations, InsertTaxObligation, clientObligations, InsertClientObligation, taxDeadlines, InsertTaxDeadline, tasks, InsertTask, taskAttachments, InsertTaskAttachment, deadlineAttachments, InsertDeadlineAttachment, appSettings, InsertAppSetting, dianCalendar, InsertDianCalendar, clientDriveSubfolders, timeEntries, InsertTimeEntry, comments, InsertComment, historyEvents, notifications, workLocationEntries, taskRecurrences, InsertTaskRecurrence, boardPosts, boardAttachments, rentaClientes, InsertRentaCliente, rentaExogena, InsertRentaExogena, rentaExogenaItems, InsertRentaExogenaItem } from "../drizzle/schema";
import { ENV } from './_core/env';
import { bogotaTodayUTCMidnight } from "./dateUtils";

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
  // Never send passwordHash or the internal openId to any frontend, admin
  // included — there's no legitimate reason for either to leave the server.
  return db.select({
    id: users.id,
    username: users.username,
    name: users.name,
    email: users.email,
    cedula: users.cedula,
    role: users.role,
    isActive: users.isActive,
    phone: users.phone,
    position: users.position,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    lastSignedIn: users.lastSignedIn,
  }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.name));
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
  const safeColumns = {
    id: users.id,
    username: users.username,
    name: users.name,
    email: users.email,
    cedula: users.cedula,
    role: users.role,
    isActive: users.isActive,
    phone: users.phone,
    position: users.position,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt,
    lastSignedIn: users.lastSignedIn,
  };
  const conditions = [];
  if (filters.role) conditions.push(eq(users.role, filters.role as any));
  if (filters.isActive !== undefined) conditions.push(eq(users.isActive, filters.isActive));
  if (conditions.length === 0) return db.select(safeColumns).from(users).orderBy(asc(users.name));
  return db.select(safeColumns).from(users).where(and(...conditions)).orderBy(asc(users.name));
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
    obligationIsActive: taxObligations.isActive,
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

export async function getDeadlineById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(taxDeadlines).where(eq(taxDeadlines.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
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
    reviewStatus: taxDeadlines.reviewStatus,
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
  // Compare against the START of today in Bogotá (not UTC, and not the
  // exact current moment) — deadline dates are stored as UTC midnight of
  // their calendar day, so comparing against UTC's current calendar date
  // makes "today" flip 5 hours early (7pm Bogotá time), showing tomorrow's
  // deadlines as due today for the rest of the evening.
  const now = bogotaTodayUTCMidnight();
  const future = new Date(now);
  future.setUTCDate(future.getUTCDate() + daysAhead);
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
    // Fresh submission (possibly after a correction) — clear the previous
    // review outcome so it shows as "sin revisar" again.
    reviewStatus: null,
    reviewNotes: null,
    reviewedById: null,
    reviewedAt: null,
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

// ==================== TIME TRACKING (self-reported clock in/out) ====================

const TIME_ENTRY_TYPES = ["inicio", "salida_almuerzo", "regreso_almuerzo", "fin"] as const;
export type TimeEntryType = typeof TIME_ENTRY_TYPES[number];

export async function createTimeEntry(userId: number, type: TimeEntryType) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(timeEntries).values({ userId, type });
}

/** Entries for one user within a date range — the caller (frontend) computes
 * the range using its own local clock, so "today" always means the
 * collaborator's own calendar day, not the server's. */
export async function getUserTimeEntries(userId: number, start: Date, end: Date) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), gte(timeEntries.timestamp, start), lte(timeEntries.timestamp, end)))
    .orderBy(asc(timeEntries.timestamp));
}

/** Admin log: every collaborator's marks within a range, plus which tasks
 * and deadlines they completed in that same window — so an admin can see
 * both the clock-in/out record and what was actually worked on. */
export async function getTimeTrackingLog(start: Date, end: Date, userId?: number) {
  const db = await getDb();
  if (!db) return { entries: [] as any[], completedTasks: [] as any[], completedDeadlines: [] as any[] };

  const entryConditions = [gte(timeEntries.timestamp, start), lte(timeEntries.timestamp, end)];
  if (userId) entryConditions.push(eq(timeEntries.userId, userId));

  const entries = await db.select({
    id: timeEntries.id,
    userId: timeEntries.userId,
    userName: users.name,
    type: timeEntries.type,
    timestamp: timeEntries.timestamp,
  })
    .from(timeEntries)
    .leftJoin(users, eq(timeEntries.userId, users.id))
    .where(and(...entryConditions))
    .orderBy(asc(timeEntries.timestamp));

  const taskConditions = [gte(tasks.completedAt, start), lte(tasks.completedAt, end)];
  if (userId) taskConditions.push(eq(tasks.completedById, userId));
  const completedTasks = await db.select({
    id: tasks.id,
    title: tasks.title,
    clientName: clients.razonSocial,
    completedById: tasks.completedById,
    completedByName: users.name,
    completedAt: tasks.completedAt,
  })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(users, eq(tasks.completedById, users.id))
    .where(and(...taskConditions))
    .orderBy(asc(tasks.completedAt));

  const deadlineConditions = [gte(taxDeadlines.completedAt, start), lte(taxDeadlines.completedAt, end)];
  if (userId) deadlineConditions.push(eq(taxDeadlines.completedById, userId));
  const completedDeadlines = await db.select({
    id: taxDeadlines.id,
    obligationName: taxObligations.name,
    clientName: clients.razonSocial,
    completedById: taxDeadlines.completedById,
    completedByName: users.name,
    completedAt: taxDeadlines.completedAt,
  })
    .from(taxDeadlines)
    .innerJoin(clients, eq(taxDeadlines.clientId, clients.id))
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .leftJoin(users, eq(taxDeadlines.completedById, users.id))
    .where(and(...deadlineConditions))
    .orderBy(asc(taxDeadlines.completedAt));

  return { entries, completedTasks, completedDeadlines };
}

// ==================== WORK LOCATION (in-house / client / on leave) ====================

export type WorkLocationSlot = { type: "in_house" | "client" | "libre"; clientId?: number };

/** Saves (or replaces) a collaborator's hour-by-hour location plan for one
 * work block of their own day — called when they mark "inicio" or
 * "regreso_almuerzo". Always exactly 4 slots, one per hour of the block. */
export async function saveWorkLocation(userId: number, date: string, block: "morning" | "afternoon", slots: WorkLocationSlot[]) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select({ id: workLocationEntries.id }).from(workLocationEntries)
    .where(and(eq(workLocationEntries.userId, userId), eq(workLocationEntries.date, date), eq(workLocationEntries.block, block)))
    .limit(1);
  const slotsJson = JSON.stringify(slots);
  if (existing.length > 0) {
    await db.update(workLocationEntries).set({ slots: slotsJson }).where(eq(workLocationEntries.id, existing[0].id));
  } else {
    await db.insert(workLocationEntries).values({ userId, date, block, slots: slotsJson });
  }
}

/** A single collaborator's location plan for one day (both blocks, if set). */
export async function getWorkLocation(userId: number, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(workLocationEntries)
    .where(and(eq(workLocationEntries.userId, userId), eq(workLocationEntries.date, date)));
}

/** Every collaborator's location plan for one day — used in the Asistencia
 * admin view, joined with client names so the slots read as "Cliente X"
 * instead of just an id. */
export async function getWorkLocationsForDate(date: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    id: workLocationEntries.id,
    userId: workLocationEntries.userId,
    block: workLocationEntries.block,
    slots: workLocationEntries.slots,
  }).from(workLocationEntries).where(eq(workLocationEntries.date, date));

  // Resolve client names for any "client" slots in one pass.
  const clientIds = new Set<number>();
  const parsed = rows.map(r => {
    const slots: WorkLocationSlot[] = JSON.parse(r.slots);
    slots.forEach(s => { if (s.type === "client" && s.clientId) clientIds.add(s.clientId); });
    return { ...r, slots };
  });
  const clientRows = clientIds.size > 0
    ? await db.select({ id: clients.id, razonSocial: clients.razonSocial }).from(clients).where(inArray(clients.id, Array.from(clientIds)))
    : [];
  const clientNameById: Record<number, string> = {};
  for (const c of clientRows) clientNameById[c.id] = c.razonSocial;

  return parsed.map(r => ({
    ...r,
    slots: r.slots.map(s => ({ ...s, clientName: s.clientId ? clientNameById[s.clientId] : undefined })),
  }));
}

// ==================== AI ASSISTANT CONTEXT ====================

/** Gathers the most recent evidence files for a client (from completed
 * tasks and completed deadlines alike) so the AI assistant can answer
 * questions like "what did we report last period" using real documents,
 * instead of guessing. */
export async function getClientEvidenceContext(clientId: number, limit: number = 8) {
  const db = await getDb();
  if (!db) return [] as { title: string; detail: string; date: Date | null; fileUrl: string; fileKey: string; contentType: string | null }[];

  const taskEvidence = await db.select({
    fileName: taskAttachments.fileName,
    fileUrl: taskAttachments.fileUrl,
    fileKey: taskAttachments.fileKey,
    contentType: taskAttachments.contentType,
    createdAt: taskAttachments.createdAt,
    taskTitle: tasks.title,
  })
    .from(taskAttachments)
    .innerJoin(tasks, eq(taskAttachments.taskId, tasks.id))
    .where(and(eq(tasks.clientId, clientId), eq(taskAttachments.isEvidence, true)))
    .orderBy(desc(taskAttachments.createdAt))
    .limit(limit);

  const deadlineEvidence = await db.select({
    fileName: deadlineAttachments.fileName,
    fileUrl: deadlineAttachments.fileUrl,
    fileKey: deadlineAttachments.fileKey,
    contentType: deadlineAttachments.contentType,
    createdAt: deadlineAttachments.createdAt,
    obligationName: taxObligations.name,
    period: taxDeadlines.period,
  })
    .from(deadlineAttachments)
    .innerJoin(taxDeadlines, eq(deadlineAttachments.deadlineId, taxDeadlines.id))
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .where(eq(taxDeadlines.clientId, clientId))
    .orderBy(desc(deadlineAttachments.createdAt))
    .limit(limit);

  const combined = [
    ...taskEvidence.map(t => ({
      title: t.fileName,
      detail: `Soporte de la tarea "${t.taskTitle}"`,
      date: t.createdAt,
      fileUrl: t.fileUrl,
      fileKey: t.fileKey,
      contentType: t.contentType,
    })),
    ...deadlineEvidence.map(d => ({
      title: d.fileName,
      detail: `Soporte de "${d.obligationName}" — período ${d.period}`,
      date: d.createdAt,
      fileUrl: d.fileUrl,
      fileKey: d.fileKey,
      contentType: d.contentType,
    })),
  ];

  combined.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  return combined.slice(0, limit);
}

// ==================== COMMENTS ====================

export async function getComments(entityType: "task" | "deadline" | "board_post", entityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: comments.id,
    entityType: comments.entityType,
    entityId: comments.entityId,
    authorId: comments.authorId,
    authorName: users.name,
    content: comments.content,
    createdAt: comments.createdAt,
  })
    .from(comments)
    .leftJoin(users, eq(comments.authorId, users.id))
    .where(and(eq(comments.entityType, entityType), eq(comments.entityId, entityId)))
    .orderBy(asc(comments.createdAt));
}

export async function createComment(entityType: "task" | "deadline" | "board_post", entityId: number, authorId: number, content: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(comments).values({ entityType, entityId, authorId, content });
}

/** Comment counts for several items at once (e.g. every task in a list) —
 * one query instead of one per row. */
export async function getCommentCounts(entityType: "task" | "deadline", entityIds: number[]) {
  const db = await getDb();
  if (!db || entityIds.length === 0) return {} as Record<number, number>;
  const rows = await db.select({
    entityId: comments.entityId,
    count: sql<number>`count(*)`,
  })
    .from(comments)
    .where(and(eq(comments.entityType, entityType), inArray(comments.entityId, entityIds)))
    .groupBy(comments.entityId);
  const map: Record<number, number> = {};
  for (const r of rows) map[r.entityId] = Number(r.count);
  return map;
}

// ==================== HISTORY (audit trail) ====================

export type HistoryEventType = "creada" | "completada" | "correccion_solicitada" | "aprobada" | "reabierta" | "cancelada";

export async function logHistoryEvent(
  entityType: "task" | "deadline",
  entityId: number,
  eventType: HistoryEventType,
  userId: number,
  notes?: string | null
) {
  const db = await getDb();
  if (!db) return;
  await db.insert(historyEvents).values({ entityType, entityId, eventType, userId, notes: notes || null });
}

export async function getHistory(entityType: "task" | "deadline", entityId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: historyEvents.id,
    eventType: historyEvents.eventType,
    userId: historyEvents.userId,
    userName: users.name,
    notes: historyEvents.notes,
    createdAt: historyEvents.createdAt,
  })
    .from(historyEvents)
    .leftJoin(users, eq(historyEvents.userId, users.id))
    .where(and(eq(historyEvents.entityType, entityType), eq(historyEvents.entityId, entityId)))
    .orderBy(asc(historyEvents.createdAt));
}

// ==================== NOTIFICATIONS ====================

export type NotificationType = "comentario" | "aprobada" | "correccion_solicitada" | "tablero_post";

export async function createNotification(
  userId: number,
  type: NotificationType,
  entityType: "task" | "deadline" | "board_post",
  entityId: number,
  title: string,
  message?: string | null,
  clientId?: number | null
) {
  const db = await getDb();
  if (!db) return;
  // No point notifying someone about their own action, and avoids a
  // pointless row if a system ever calls this for the same user by mistake.
  if (!userId) return;
  await db.insert(notifications).values({ userId, type, entityType, entityId, title, message: message || null, clientId: clientId || null });
}

export async function getNotifications(userId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db.select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return Number(row?.count || 0);
}

export async function markNotificationRead(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: true }).where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}

/** Housekeeping — deletes already-read notifications older than a day, so
 * the list doesn't grow forever. Deliberately never touches unread ones,
 * even if old, so nothing actionable gets silently lost. Runs piggybacked
 * on normal traffic (checking unread count, logging out) rather than a
 * separate scheduled job, since there's no cron infrastructure for this app. */
export async function cleanupOldReadNotifications(userId: number) {
  const db = await getDb();
  if (!db) return;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.delete(notifications).where(
    and(eq(notifications.userId, userId), eq(notifications.isRead, true), lte(notifications.createdAt, oneDayAgo))
  );
}

/** Recent/relevant tasks and deadlines for a client, with their comments —
 * gives the AI assistant real operational awareness (what's pending, what
 * was discussed) instead of only reading uploaded documents. */
export async function getClientOperationalContext(clientId: number) {
  const db = await getDb();
  if (!db) return { tasks: [] as any[], deadlines: [] as any[] };

  const clientTasks = await db.select({
    id: tasks.id,
    title: tasks.title,
    description: tasks.description,
    status: tasks.status,
    dueDate: tasks.dueDate,
    assignedToName: users.name,
    completedAt: tasks.completedAt,
    completionNotes: tasks.completionNotes,
  })
    .from(tasks)
    .leftJoin(users, eq(tasks.assignedToId, users.id))
    .where(eq(tasks.clientId, clientId))
    .orderBy(desc(tasks.createdAt))
    .limit(15);

  const clientDeadlines = await db.select({
    id: taxDeadlines.id,
    obligationName: taxObligations.name,
    period: taxDeadlines.period,
    dueDate: taxDeadlines.dueDate,
    status: taxDeadlines.status,
    completedAt: taxDeadlines.completedAt,
  })
    .from(taxDeadlines)
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
    .where(eq(taxDeadlines.clientId, clientId))
    .orderBy(desc(taxDeadlines.dueDate))
    .limit(15);

  const tasksWithComments = await Promise.all(
    clientTasks.map(async t => ({ ...t, comments: await getComments("task", t.id) }))
  );
  const deadlinesWithComments = await Promise.all(
    clientDeadlines.map(async d => ({ ...d, comments: await getComments("deadline", d.id) }))
  );

  return { tasks: tasksWithComments, deadlines: deadlinesWithComments };
}

/** Wipes ALL tasks and tax deadlines (and everything that hangs off them:
 * attachments, comments) — used once to clear out test/demo data before
 * starting real tracking. Deliberately does NOT touch clients, the
 * obligations catalog, client-obligation assignments, collaborators, or the
 * DIAN calendar — all of that is real master data needed to regenerate
 * deadlines afterward. Only callable from the one-off script, not exposed
 * as an API endpoint, since this is destructive and irreversible. */
export async function clearAllTasksAndDeadlines() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [taskCountRows] = await db.select({ count: sql<number>`count(*)` }).from(tasks);
  const [deadlineCountRows] = await db.select({ count: sql<number>`count(*)` }).from(taxDeadlines);
  const taskCount = Number(taskCountRows?.count || 0);
  const deadlineCount = Number(deadlineCountRows?.count || 0);

  // Children first, then the parent rows.
  await db.delete(comments).where(eq(comments.entityType, "task"));
  await db.delete(comments).where(eq(comments.entityType, "deadline"));
  await db.delete(taskAttachments);
  await db.delete(deadlineAttachments);
  await db.delete(tasks);
  await db.delete(taxDeadlines);

  return { tasksDeleted: taskCount, deadlinesDeleted: deadlineCount };
}

/** Admin-only: reopens a deadline that was mistakenly marked completed. */
export async function reopenDeadline(id: number, reopenedById: number) {
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
  await logHistoryEvent("deadline", id, "reabierta", reopenedById);
}

/** Manually correct a single deadline's due date, e.g. when the auto-generated
 * or DIAN-imported date turns out to be wrong for that specific client/period. */
export async function updateDeadlineDueDate(id: number, dueDate: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxDeadlines).set({ dueDate }).where(eq(taxDeadlines.id, id));
}

/** Clears out a client's deadlines before regenerating the calendar — but
 * only the ones that were never started (no evidence attached). Completed
 * or in-progress-with-evidence deadlines are real work product and must
 * never be silently wiped out by a recalculation. */
export async function deleteClientDeadlines(clientId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(taxDeadlines).where(
    and(eq(taxDeadlines.clientId, clientId), sql`${taxDeadlines.evidenceFileUrl} IS NULL`)
  );
}

// ==================== TASKS ====================

export async function createTask(data: InsertTask) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(tasks).values(data);
  const id = result[0].insertId;
  await logHistoryEvent("task", id, "creada", data.createdById || data.assignedToId || 0);
  return id;
}

// ==================== RECURRING TASKS ====================

export async function createTaskRecurrence(data: InsertTaskRecurrence) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(taskRecurrences).values(data);
  return result[0].insertId;
}

export async function getTaskRecurrences() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: taskRecurrences.id,
    title: taskRecurrences.title,
    description: taskRecurrences.description,
    clientId: taskRecurrences.clientId,
    clientName: clients.razonSocial,
    assignedToId: taskRecurrences.assignedToId,
    assignedToName: users.name,
    priority: taskRecurrences.priority,
    recurrenceType: taskRecurrences.recurrenceType,
    dayOfWeek: taskRecurrences.dayOfWeek,
    dayOfMonth: taskRecurrences.dayOfMonth,
    isActive: taskRecurrences.isActive,
    createdAt: taskRecurrences.createdAt,
  })
    .from(taskRecurrences)
    .innerJoin(clients, eq(taskRecurrences.clientId, clients.id))
    .leftJoin(users, eq(taskRecurrences.assignedToId, users.id))
    .orderBy(desc(taskRecurrences.createdAt));
}

export async function setTaskRecurrenceActive(id: number, isActive: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(taskRecurrences).set({ isActive }).where(eq(taskRecurrences.id, id));
}

export async function deleteTaskRecurrence(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(taskRecurrences).where(eq(taskRecurrences.id, id));
}

function lastDayOfMonthUTC(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

/** Which due date(s) a rule should have a generated task for, given
 * "today". Weekly/monthly give exactly one candidate for the current
 * cycle; quincenal gives up to two (the 15th and the last day of the
 * month), since both may already be due within the same month. */
function computeCandidateDueDates(rule: { recurrenceType: string; dayOfWeek: number | null; dayOfMonth: number | null }, today: Date): Date[] {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();

  if (rule.recurrenceType === "semanal") {
    const targetDow = rule.dayOfWeek ?? 5; // default Friday
    const currentDow = today.getUTCDay();
    const diff = targetDow - currentDow;
    const d = new Date(Date.UTC(year, month, today.getUTCDate() + diff));
    return [d];
  }

  if (rule.recurrenceType === "mensual") {
    const day = Math.min(rule.dayOfMonth ?? 1, lastDayOfMonthUTC(year, month));
    return [new Date(Date.UTC(year, month, day))];
  }

  // quincenal — fixed at the 15th and the last day of the current month.
  const lastDay = lastDayOfMonthUTC(year, month);
  return [new Date(Date.UTC(year, month, 15)), new Date(Date.UTC(year, month, lastDay))];
}

/** Checks every active recurrence rule and creates any task instance whose
 * cycle has come up but wasn't generated yet (checked directly against
 * existing tasks linked to that rule, so nothing is ever duplicated even
 * if this is run more than once). Returns how many were created. */
export async function generateDueRecurringTasks(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rules = await db.select().from(taskRecurrences).where(eq(taskRecurrences.isActive, true));

  const today = bogotaTodayUTCMidnight();

  let created = 0;
  for (const rule of rules) {
    const candidates = computeCandidateDueDates(rule, today).filter(d => d.getTime() <= today.getTime());
    for (const dueDate of candidates) {
      const existing = await db.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.recurrenceId, rule.id), eq(tasks.dueDate, dueDate)))
        .limit(1);
      if (existing.length > 0) continue;

      const insertResult = await db.insert(tasks).values({
        title: rule.title,
        description: rule.description,
        clientId: rule.clientId,
        assignedToId: rule.assignedToId,
        createdById: rule.createdById,
        dueDate,
        priority: rule.priority,
        isAutoGenerated: true,
        recurrenceId: rule.id,
      });
      await logHistoryEvent("task", insertResult[0].insertId, "creada", rule.createdById);
      created++;
    }
  }
  return created;
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
    reviewStatus: tasks.reviewStatus,
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

  // Non-admins ven las tareas asignadas a ellos O que ellos mismos crearon
  // (ahora que los colaboradores también pueden crear tareas) — no cada
  // tarea de los clientes que manejan (ese alcance más amplio es para
  // vencimientos, donde el encargado responde por TODAS las obligaciones
  // de un cliente; las tareas tienen su propio responsable individual).
  if (assignedToId) {
    return query.where(or(eq(tasks.assignedToId, assignedToId), eq(tasks.createdById, assignedToId))).orderBy(desc(tasks.createdAt));
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
    reviewStatus: "aprobado",
    reviewedById,
    reviewedAt: new Date(),
    reviewNotes: reviewNotes || null,
  }).where(eq(tasks.id, id));
  await logHistoryEvent("task", id, "aprobada", reviewedById, reviewNotes);
}

/** Sends a completed task back to the collaborator for correction: clears
 * the evidence so they upload fresh corrected files, reverts status to
 * pendiente, and records the observation so they see exactly what to fix. */
export async function requestTaskCorrection(id: number, reviewedById: number, reviewNotes: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(taskAttachments).where(and(eq(taskAttachments.taskId, id), eq(taskAttachments.isEvidence, true)));
  await db.update(tasks).set({
    status: "pendiente",
    completedAt: null,
    completedById: null,
    evidenceFileUrl: null,
    evidenceFileKey: null,
    driveSubfolder: null,
    completionNotes: null,
    reviewStatus: "correccion",
    reviewedById,
    reviewedAt: new Date(),
    reviewNotes,
  }).where(eq(tasks.id, id));
  await logHistoryEvent("task", id, "correccion_solicitada", reviewedById, reviewNotes);
}

export async function approveDeadline(id: number, reviewedById: number, reviewNotes?: string | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(taxDeadlines).set({
    reviewStatus: "aprobado",
    reviewedById,
    reviewedAt: new Date(),
    reviewNotes: reviewNotes || null,
  }).where(eq(taxDeadlines.id, id));
  await logHistoryEvent("deadline", id, "aprobada", reviewedById, reviewNotes);
}

/** Same idea as requestTaskCorrection, but for a tax deadline. */
export async function requestDeadlineCorrection(id: number, reviewedById: number, reviewNotes: string) {
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
    reviewStatus: "correccion",
    reviewedById,
    reviewedAt: new Date(),
    reviewNotes,
  }).where(eq(taxDeadlines.id, id));
  await logHistoryEvent("deadline", id, "correccion_solicitada", reviewedById, reviewNotes);
}

/** Admin cancels a task that's no longer needed. If nothing was ever
 * attached to it, it's just removed outright — there's no work to preserve.
 * If evidence/a response was already attached, it's kept for the record but
 * marked "cancelada" so it stops counting as active work on the dashboard. */
export async function cancelTask(id: number, cancelledById: number): Promise<"deleted" | "cancelled"> {
  const db = await getDb();
  if (!db) return "deleted";
  const task = await getTaskById(id);
  if (!task) return "deleted";

  if (!task.evidenceFileUrl) {
    await db.delete(tasks).where(eq(tasks.id, id));
    return "deleted";
  }

  await db.update(tasks).set({ status: "cancelada" }).where(eq(tasks.id, id));
  await logHistoryEvent("task", id, "cancelada", cancelledById);
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
  taskSearch?: string; // busca por texto en el título de la tarea/obligación
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
  if (filters.taskSearch) taskConditions.push(like(tasks.title, `%${filters.taskSearch}%`));

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
    reviewStatus: tasks.reviewStatus,
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
  if (filters.taskSearch) deadlineConditions.push(like(taxObligations.name, `%${filters.taskSearch}%`));

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
    reviewStatusRaw: taxDeadlines.reviewStatus,
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
      reviewStatus: t.reviewStatus,
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
      reviewStatus: d.reviewStatusRaw,
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
  // Nothing automatically flips a task's stored status to "vencida" when its
  // due date passes — that only happens if someone picks it manually. For
  // these counts/groupings, treat an overdue pendiente/en_progreso task as
  // vencida so the KPI actually reflects reality.
  const todayUTCMidnight = bogotaTodayUTCMidnight();
  const taskStats = { pendiente: 0, en_progreso: 0, completada: 0, vencida: 0 };
  const tasksByStatus: Record<string, any[]> = { pendiente: [], en_progreso: [], completada: [], vencida: [] };
  for (const t of taskRows) {
    let effectiveStatus = t.status;
    if ((t.status === "pendiente" || t.status === "en_progreso") && t.dueDate && new Date(t.dueDate).getTime() < todayUTCMidnight.getTime()) {
      effectiveStatus = "vencida";
    }
    if (effectiveStatus in taskStats) {
      taskStats[effectiveStatus as keyof typeof taskStats]++;
      if (tasksByStatus[effectiveStatus].length < 8) tasksByStatus[effectiveStatus].push(t);
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

// ==================== TABLERO ====================
// Mensajes generales para todo el equipo, con o sin obligación tributaria
// asociada (null = "General"). Los comentarios de cada publicación
// reutilizan la tabla `comments` genérica (entityType="board_post").

export async function createBoardPost(authorId: number, content: string, obligationId?: number | null): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(boardPosts).values({ authorId, content, obligationId: obligationId ?? null });
  return Number((result as any).insertId ?? (result as any)[0]?.insertId);
}

/** filters.obligationId: undefined = todas las publicaciones; null =
 * solo "General"; un número = solo esa obligación. */
export async function getBoardPosts(filters: { obligationId?: number | null; busqueda?: string }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [];
  if (filters.obligationId === null) conditions.push(isNull(boardPosts.obligationId));
  else if (typeof filters.obligationId === "number") conditions.push(eq(boardPosts.obligationId, filters.obligationId));

  if (filters.busqueda && filters.busqueda.trim()) {
    const termino = `%${filters.busqueda.trim()}%`;
    // Coincide si el texto está en la publicación misma, o en alguno de sus
    // comentarios/respuestas — así una búsqueda encuentra el tema aunque la
    // palabra solo aparezca en una respuesta, no en el mensaje original.
    const conComentarioCoincidente = await db.select({ entityId: comments.entityId })
      .from(comments)
      .where(and(eq(comments.entityType, "board_post"), like(comments.content, termino)));
    const idsPorComentario = conComentarioCoincidente.map(r => r.entityId);
    conditions.push(
      idsPorComentario.length > 0
        ? or(like(boardPosts.content, termino), inArray(boardPosts.id, idsPorComentario))
        : like(boardPosts.content, termino),
    );
  }

  return db.select({
    id: boardPosts.id,
    content: boardPosts.content,
    obligationId: boardPosts.obligationId,
    obligationName: taxObligations.name,
    pinned: boardPosts.pinned,
    authorId: boardPosts.authorId,
    authorName: users.name,
    createdAt: boardPosts.createdAt,
  })
    .from(boardPosts)
    .leftJoin(users, eq(boardPosts.authorId, users.id))
    .leftJoin(taxObligations, eq(boardPosts.obligationId, taxObligations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(boardPosts.pinned), desc(boardPosts.createdAt));
}

export async function getBoardPostById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({
    id: boardPosts.id,
    content: boardPosts.content,
    obligationId: boardPosts.obligationId,
    obligationName: taxObligations.name,
    pinned: boardPosts.pinned,
    authorId: boardPosts.authorId,
    authorName: users.name,
    createdAt: boardPosts.createdAt,
  })
    .from(boardPosts)
    .leftJoin(users, eq(boardPosts.authorId, users.id))
    .leftJoin(taxObligations, eq(boardPosts.obligationId, taxObligations.id))
    .where(eq(boardPosts.id, id));
  return rows[0] || null;
}

export async function setBoardPostPinned(id: number, pinned: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(boardPosts).set({ pinned }).where(eq(boardPosts.id, id));
}

export async function deleteBoardPost(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(boardAttachments).where(eq(boardAttachments.postId, id));
  await db.delete(comments).where(and(eq(comments.entityType, "board_post"), eq(comments.entityId, id)));
  await db.delete(boardPosts).where(eq(boardPosts.id, id));
}

export async function createBoardAttachment(data: {
  postId: number; fileName: string; fileUrl: string; fileKey: string;
  contentType?: string; fileSize?: number; uploadedById: number;
}): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(boardAttachments).values(data);
  return Number((result as any).insertId ?? (result as any)[0]?.insertId);
}

export async function getBoardPostAttachments(postId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(boardAttachments).where(eq(boardAttachments.postId, postId)).orderBy(asc(boardAttachments.createdAt));
}

/** Todos los usuarios activos, para notificar de una publicación nueva
 * (menos a quien la publicó). */
export async function getAllActiveUserIds(excludeUserId?: number): Promise<number[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
  return rows.map(r => r.id).filter(id => id !== excludeUserId);
}

/** Publicaciones recientes del Tablero (con nombre de la obligación y sus
 * adjuntos), para que el asistente de IA las use como contexto — el
 * Tablero es conocimiento general del equipo (aclaraciones de proceso,
 * documentos de estudio), útil sin importar de qué cliente se esté
 * preguntando. Limitado a las más recientes (fijadas primero) para no
 * inflar cada consulta con todo el histórico. */
export async function getBoardContextForAssistant(limite: number = 15) {
  const db = await getDb();
  if (!db) return [];
  const posts = await db.select({
    id: boardPosts.id,
    content: boardPosts.content,
    obligationName: taxObligations.name,
    authorName: users.name,
    pinned: boardPosts.pinned,
    createdAt: boardPosts.createdAt,
  })
    .from(boardPosts)
    .leftJoin(users, eq(boardPosts.authorId, users.id))
    .leftJoin(taxObligations, eq(boardPosts.obligationId, taxObligations.id))
    .orderBy(desc(boardPosts.pinned), desc(boardPosts.createdAt))
    .limit(limite);

  const conAdjuntos = await Promise.all(posts.map(async p => ({
    ...p,
    adjuntos: await getBoardPostAttachments(p.id),
  })));
  return conAdjuntos;
}

// ==================== RENTA PERSONA NATURAL ====================

export async function getRentaClientes(anioGravable: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rentaClientes).where(eq(rentaClientes.anioGravable, anioGravable));
}

export async function createRentaCliente(data: InsertRentaCliente): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const result = await db.insert(rentaClientes).values(data);
  return Number((result as any).insertId ?? (result as any)[0]?.insertId);
}

export async function updateRentaCliente(id: number, data: Partial<InsertRentaCliente>) {
  const db = await getDb();
  if (!db) return;
  await db.update(rentaClientes).set(data).where(eq(rentaClientes.id, id));
}

export async function deleteRentaCliente(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(rentaClientes).where(eq(rentaClientes.id, id));
}

/** Busca el vencimiento de Renta Personas Naturales para una cédula,
 * reutilizando el calendario ya cargado en Configuración (dianCalendar) —
 * no se guarda ninguna fecha aparte, siempre se calcula en vivo contra el
 * mismo calendario que usa el resto de la aplicación. La obligación se
 * busca por nombre de forma FLEXIBLE (contiene "Renta" y "Natural"), no por
 * texto exacto — el nombre real trae guion y puede variar en mayúsculas
 * ("Renta - Personas Naturales"), y una búsqueda exacta fallaría. Se evita
 * a propósito hacer match solo con "Renta" para no confundir con "Renta -
 * Personas Jurídicas". `anioGravable` es el año que se está declarando
 * (ej. 2025); el calendario normalmente vive un año calendario después (se
 * declara en 2026), así que se prueba primero con ese año y, si no hay
 * nada, con el año gravable mismo, por si el calendario se cargó bajo ese
 * año en vez del año de declaración. */
export async function getVencimientoRentaPN(cedula: string, anioGravable: number): Promise<Date | null> {
  const db = await getDb();
  if (!db) return null;
  const obligacion = await db.select().from(taxObligations)
    .where(and(like(taxObligations.name, "%Renta%"), like(taxObligations.name, "%Natural%")))
    .limit(1);
  if (obligacion.length === 0) return null;
  const code = obligacion[0].code;

  for (const anioCalendario of [anioGravable + 1, anioGravable]) {
    for (const periodo of [String(anioGravable), String(anioCalendario)]) {
      const entrada = await getDianCalendarForDeadline(anioCalendario, code, cedula, periodo);
      if (entrada) return entrada.dueDate;
    }
  }
  return null;
}

/** Reemplaza por completo la exógena vigente de un cliente de renta (borra
 * la anterior y sus ítems, si existía, y guarda la nueva) — solo una
 * exógena activa por cliente, la más reciente que se haya subido. */
export async function guardarExogenaRenta(
  rentaClienteId: number, data: Omit<InsertRentaExogena, "rentaClienteId">, items: Omit<InsertRentaExogenaItem, "rentaExogenaId">[],
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Base de datos no disponible");
  const existente = await db.select({ id: rentaExogena.id }).from(rentaExogena)
    .where(eq(rentaExogena.rentaClienteId, rentaClienteId));
  for (const e of existente) {
    await db.delete(rentaExogenaItems).where(eq(rentaExogenaItems.rentaExogenaId, e.id));
    await db.delete(rentaExogena).where(eq(rentaExogena.id, e.id));
  }
  const result = await db.insert(rentaExogena).values({ ...data, rentaClienteId });
  const id = Number((result as any).insertId ?? (result as any)[0]?.insertId);
  for (let i = 0; i < items.length; i += 200) {
    const lote = items.slice(i, i + 200).map(it => ({ ...it, rentaExogenaId: id }));
    if (lote.length > 0) await db.insert(rentaExogenaItems).values(lote);
  }
  return id;
}

export async function getExogenaRenta(rentaClienteId: number) {
  const db = await getDb();
  if (!db) return null;
  const filas = await db.select().from(rentaExogena).where(eq(rentaExogena.rentaClienteId, rentaClienteId)).limit(1);
  if (filas.length === 0) return null;
  const items = await db.select().from(rentaExogenaItems).where(eq(rentaExogenaItems.rentaExogenaId, filas[0].id));
  return { ...filas[0], items };
}




