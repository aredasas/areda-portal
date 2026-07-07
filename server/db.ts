import { eq, and, desc, asc, like, sql, inArray, gte, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, clients, InsertClient, taxObligations, InsertTaxObligation, clientObligations, InsertClientObligation, taxDeadlines, InsertTaxDeadline, tasks, InsertTask, taskAttachments, InsertTaskAttachment, appSettings, InsertAppSetting, dianCalendar, InsertDianCalendar } from "../drizzle/schema";
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
    notes: taxDeadlines.notes,
    createdAt: taxDeadlines.createdAt,
  })
    .from(taxDeadlines)
    .innerJoin(taxObligations, eq(taxDeadlines.obligationId, taxObligations.id))
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
    eq(taxDeadlines.status, "pendiente"),
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

export async function getDeadlinesForMonth(year: number, month: number) {
  const db = await getDb();
  if (!db) return [];
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59);
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
    .where(and(
      gte(taxDeadlines.dueDate, startDate),
      lte(taxDeadlines.dueDate, endDate),
    ))
    .orderBy(asc(taxDeadlines.dueDate));
}

export async function updateDeadlineStatus(id: number, status: "pendiente" | "completado" | "vencido", completedById?: number) {
  const db = await getDb();
  if (!db) return;
  const data: Partial<InsertTaxDeadline> = { status };
  if (status === "completado") {
    data.completedAt = new Date();
    if (completedById) data.completedById = completedById;
  }
  await db.update(taxDeadlines).set(data).where(eq(taxDeadlines.id, id));
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

export async function getAllTasks(managerId?: number) {
  const db = await getDb();
  if (!db) return [];
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
    evidenceFileUrl: tasks.evidenceFileUrl,
    evidenceFileKey: tasks.evidenceFileKey,
    completionNotes: tasks.completionNotes,
    createdAt: tasks.createdAt,
  })
    .from(tasks)
    .leftJoin(clients, eq(tasks.clientId, clients.id))
    .leftJoin(users, eq(tasks.assignedToId, users.id));

  if (managerId) {
    return query.where(eq(clients.managerId, managerId)).orderBy(desc(tasks.createdAt));
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

export async function getTaskAttachments(taskId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(taskAttachments).where(eq(taskAttachments.taskId, taskId)).orderBy(desc(taskAttachments.createdAt));
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


