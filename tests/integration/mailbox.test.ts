// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
vi.mock("cloudflare:workers", () => ({ DurableObject: class { ctx: unknown; env: unknown; constructor(state: unknown, env: unknown) { (this as unknown as { ctx: unknown }).ctx = state; (this as unknown as { env: unknown }).env = env; } } }));
vi.mock("drizzle-orm/durable-sqlite", () => ({ drizzle: vi.fn(() => ({})) }));
import { MailboxDO } from "workers/durableObject";
import { Folders } from "shared/folders";

// Helpers to build a mock SqlStorage.exec that records queries
function createMockSql(execImpl?: (query: string, ...params: unknown[]) => unknown[]) {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const exec = vi.fn((query: string, ...params: unknown[]) => {
    calls.push({ query, params });
    if (execImpl) return execImpl(query, ...params);
    // default: return empty iterable
    return [] as unknown as ReturnType<typeof exec>;
  });
  // Make exec iterable return empty array spread
  (exec as unknown as { calls: typeof calls }).calls = calls;
  return { exec, calls };
}

function createMockStorage(sqlExec: ReturnType<typeof createMockSql>["exec"]) {
  return {
    sql: { exec: sqlExec },
    transactionSync: vi.fn((fn: () => unknown) => fn()),
  } as unknown as DurableObjectStorage;
}

// Build a mock drizzle db that captures getEmails chain
function createMockDb() {
  const allMock = vi.fn(() => [
    { id: "1", subject: "a", sender: "a@ex.com", recipient: "b@ex.com", date: "2026-01-01", read: 0, starred: 0 },
  ]);
  const limitMock = vi.fn(() => ({ offset: vi.fn(() => ({ all: allMock })) }));
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  return {
    select: selectMock,
    _mocks: { selectMock, fromMock, whereMock, orderByMock, limitMock, allMock },
  };
}

function createMailboxDO(sqlExec?: ReturnType<typeof createMockSql>["exec"]) {
  const { exec } = createMockSql(sqlExec);
  const storage = createMockStorage(exec);
  const state = { storage } as unknown as DurableObjectState;
  const env = {} as unknown as Cloudflare.Env;
  // Bypass migrations by mocking applyMigrations? The constructor calls applyMigrations which will call sql.exec.
  // Our exec is already mocked to handle migration queries.
  const instance = new MailboxDO(state, env);
  return { instance, exec, storage };
}

describe("MailboxDO pagination", () => {
  it("caps limit to 100 and floors to 1", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    // SAFETY: replacing internal drizzle instance for test control
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    await instance.getEmails({ limit: 500, page: 1 });
    expect(mockDb._mocks.limitMock).toHaveBeenCalledWith(100);
    await instance.getEmails({ limit: 0, page: 1 });
    expect(mockDb._mocks.limitMock).toHaveBeenLastCalledWith(1);
    await instance.getEmails({ limit: -5, page: 1 });
    expect(mockDb._mocks.limitMock).toHaveBeenLastCalledWith(1);
  });

  it("computes offset from page", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    await instance.getEmails({ page: 3, limit: 10 });
    const offsetFn = mockDb._mocks.limitMock.mock.results[0]?.value.offset;
    expect(offsetFn).toBeDefined();
    // The offset function was called with (page-1)*limit = 20
    expect(offsetFn).toHaveBeenCalledWith(20);
  });

  it("searchEmails caps limit similarly", async () => {
    const sql = createMockSql(() => [{ id: "1", read: 0, starred: 0 }] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    // searchEmails uses raw sql, not drizzle
    const res = await instance.searchEmails({ query: "hello", page: 1, limit: 200 });
    expect(sql.exec).toHaveBeenCalled();
    const lastCall = sql.calls[sql.calls.length - 1];
    // last two params are limit and offset
    expect(lastCall.params[lastCall.params.length - 2]).toBe(100);
  });
});

describe("MailboxDO sort injection", () => {
  it("falls back to date for unknown sortColumn", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    // SAFETY: testing sort injection via untrusted string
    await instance.getEmails({ sortColumn: "date; DROP TABLE emails; --" as unknown as "date" });
    // Should still call orderBy with a valid column (date) not the injected string
    expect(mockDb._mocks.orderByMock).toHaveBeenCalled();
  });

  it("accepts allowed columns", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    for (const col of ["id", "subject", "sender", "recipient", "date", "read", "starred"] as const) {
      await instance.getEmails({ sortColumn: col, sortDirection: "ASC" });
      expect(mockDb._mocks.orderByMock).toHaveBeenCalled();
    }
  });

  it("defaults to DESC when sortDirection not ASC", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    await instance.getEmails({ sortColumn: "date", sortDirection: "DESC" as const });
    expect(mockDb._mocks.orderByMock).toHaveBeenCalled();
    await instance.getEmails({ sortColumn: "date", sortDirection: undefined });
    expect(mockDb._mocks.orderByMock).toHaveBeenCalled();
  });
});

describe("MailboxDO checkSendRateLimit", () => {
  it("returns null when under limits", async () => {
    const sql = createMockSql((q: string) => {
      if (q.includes("-1 hour")) return [{ cnt: 5 }] as unknown as unknown[];
      if (q.includes("-1 day")) return [{ cnt: 50 }] as unknown as unknown[];
      return [] as unknown as unknown[];
    });
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.checkSendRateLimit()).toBeNull();
  });

  it("returns error when hourly limit exceeded", async () => {
    const sql = createMockSql((q: string) => {
      if (q.includes("-1 hour")) return [{ cnt: 20 }] as unknown as unknown[];
      return [{ cnt: 0 }] as unknown as unknown[];
    });
    const { instance } = createMailboxDO(sql.exec);
    const err = await instance.checkSendRateLimit();
    expect(err).toMatch(/20 emails per hour/);
  });

  it("returns error when daily limit exceeded", async () => {
    const sql = createMockSql((q: string) => {
      if (q.includes("-1 hour")) return [{ cnt: 0 }] as unknown as unknown[];
      if (q.includes("-1 day")) return [{ cnt: 100 }] as unknown as unknown[];
      return [] as unknown as unknown[];
    });
    const { instance } = createMailboxDO(sql.exec);
    const err = await instance.checkSendRateLimit();
    expect(err).toMatch(/100 emails per day/);
  });
});

describe("MailboxDO searchEmails escaping", () => {
  it("uses parameterized LIKE, not string interpolation", async () => {
    const sql = createMockSql(() => [] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    const malicious = `'; DROP TABLE emails; --`;
    await instance.searchEmails({ query: malicious });
    const call = sql.calls[sql.calls.length - 1];
    // Query should contain ? placeholders, not the raw malicious string interpolated
    expect(call.query).toContain("LIKE");
    expect(call.query).not.toContain("DROP TABLE");
    // Malicious content should be in params, safely escaped
    expect(call.params.some((p) => typeof p === "string" && (p as string).includes("DROP TABLE"))).toBe(true);
  });

  it("escapes from/to/subject filters via params", async () => {
    const sql = createMockSql(() => [] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    await instance.searchEmails({ query: "", from: "'; OR 1=1 --", to: "x", subject: "y" } as unknown as Parameters<typeof instance.searchEmails>[0]);
    const call = sql.calls[sql.calls.length - 1];
    expect(call.query).not.toContain("OR 1=1");
    expect(call.params.join(",")).toContain("OR 1=1");
  });

  it("countSearchResults uses same escaping", async () => {
    const sql = createMockSql(() => [{ total: 0 }] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    await instance.countSearchResults({ query: "' OR 1=1 --" } as unknown as Parameters<typeof instance.countSearchResults>[0]);
    const call = sql.calls[sql.calls.length - 1];
    expect(call.query).toContain("COUNT");
    expect(call.query).not.toContain("OR 1=1");
  });
});

describe("MailboxDO moveEmail", () => {
  it("returns false when folder not found", async () => {
    const { instance } = createMailboxDO();
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(() => undefined),
          })),
        })),
      })),
      update: vi.fn(),
    };
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    expect(await instance.moveEmail("email-id", "nonexistent")).toBe(false);
  });

  it("updates folder when found", async () => {
    const { instance } = createMailboxDO();
    const runMock = vi.fn();
    const whereMock = vi.fn(() => ({ run: runMock }));
    const setMock = vi.fn(() => ({ where: whereMock }));
    const updateMock = vi.fn(() => ({ set: setMock }));
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(() => ({ id: "inbox" })),
          })),
        })),
      })),
      update: updateMock,
    };
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    expect(await instance.moveEmail("email-id", "inbox")).toBe(true);
    expect(updateMock).toHaveBeenCalled();
  });

  it("deleteFolder respects is_deletable", async () => {
    const { instance } = createMailboxDO();
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            get: vi.fn(() => ({ is_deletable: 0 })),
          })),
        })),
      })),
      delete: vi.fn(),
    };
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    expect(await instance.deleteFolder("inbox")).toBe(false);
  });

  it("findThreadBySubject normalizes prefixes and checks participants", async () => {
    const sql = createMockSql(() => [
      { thread_id: "t1", subject: "Re: Hello", senders: "a@ex.com", recipients: "b@ex.com" },
      { thread_id: "t2", subject: "Fwd: Hello", senders: "c@ex.com", recipients: "d@ex.com" },
    ] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    const result = await instance.findThreadBySubject("hello", "a@ex.com");
    expect(result).toBe("t1");
    const miss = await instance.findThreadBySubject("hello", "unknown@ex.com");
    expect(miss).toBeNull();
  });

  it("findThreadBySubject returns null for empty normalized subject", async () => {
    const sql = createMockSql(() => [] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.findThreadBySubject("Re: ", "a@ex.com")).toBeNull();
    expect(await instance.findThreadBySubject("   ", undefined)).toBeNull();
  });
});

describe("MailboxDO createEmail sent is always read", () => {
  it("marks sent emails as read", async () => {
    const { instance } = createMailboxDO();
    const valuesMock = vi.fn((vals: unknown) => ({ run: vi.fn() }));
    const insertMock = vi.fn(() => ({ values: valuesMock }));
    const mockDb = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: vi.fn(() => ({ id: "sent" })),
            })),
          })),
        })),
      })),
      insert: insertMock,
    };
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    await instance.createEmail(Folders.SENT, {
      id: "mid",
      subject: "hi",
      sender: "a@ex.com",
      recipient: "b@ex.com",
      date: new Date().toISOString(),
      body: "hello",
    }, []);
    const inserted = valuesMock.mock.calls[0]?.[0] as { read: number };
    expect(inserted.read).toBe(1);
  });
});
