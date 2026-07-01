import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createUserContext(role: string = "contador_junior"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "user-123",
    email: "user@example.com",
    name: "Test User",
    loginMethod: "local",
    role: role as any,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-123",
    email: "admin@example.com",
    name: "Admin User",
    loginMethod: "local",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("auth router", () => {
  it("returns null for unauthenticated user", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });
});

describe("collaborators router - role-based access", () => {
  it("admin can access collaborators.list", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.collaborators.list();
    expect(Array.isArray(result)).toBe(true);
  });

  it("non-admin cannot create collaborators", async () => {
    const ctx = createUserContext("asistente");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.collaborators.create({
        name: "Hacker",
        username: "hacker",
        password: "123456",
        role: "admin",
      })
    ).rejects.toThrow();
  });

  it("non-admin cannot deactivate collaborators", async () => {
    const ctx = createUserContext("contador_junior");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.collaborators.deactivate({ id: 1 })
    ).rejects.toThrow();
  });
});

describe("clients router - protected access", () => {
  it("unauthenticated user cannot list clients", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.clients.list()).rejects.toThrow();
  });

  it("authenticated user can list clients", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.clients.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("obligations router - protected access", () => {
  it("authenticated user can list obligations", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.obligations.list();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("tasks router - protected access", () => {
  it("unauthenticated user cannot list tasks", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.tasks.list()).rejects.toThrow();
  });

  it("authenticated user can list tasks", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.tasks.list();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("dashboard router - protected access", () => {
  it("authenticated user can access dashboard summary", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dashboard.summary();
    expect(result).toHaveProperty("taskStats");
    expect(result).toHaveProperty("upcomingDeadlines");
    expect(result).toHaveProperty("workload");
    expect(result).toHaveProperty("tasksByStatus");
  });

  it("unauthenticated user cannot access dashboard", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.dashboard.summary()).rejects.toThrow();
  });
});

describe("settings router - admin only", () => {
  it("admin can get all settings", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.settings.getAll();
    expect(Array.isArray(result)).toBe(true);
  });

  it("non-admin cannot set settings", async () => {
    const ctx = createUserContext("contador_senior");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.settings.set({ key: "test", value: "test" })
    ).rejects.toThrow();
  });
});

describe("dianCalendar router - admin upload", () => {
  it("non-admin cannot upload DIAN calendar", async () => {
    const ctx = createUserContext("asistente");
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.dianCalendar.upload({
        year: 2026,
        entries: [{ obligationCode: "IVA_BIM", period: "2026-01-02", lastDigitNit: "1", dueDate: "2026-03-10" }],
      })
    ).rejects.toThrow();
  });

  it("authenticated user can get DIAN calendar entries", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.dianCalendar.getEntries({ year: 2026 });
    expect(Array.isArray(result)).toBe(true);
  });
});
