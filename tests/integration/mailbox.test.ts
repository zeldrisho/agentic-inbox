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
    const injectedValue = "date; DROP TABLE emails; --";
    await instance.getEmails({ sortColumn: injectedValue as unknown as "date" });
    // Should call orderBy, but never with the injected string
    expect(mockDb._mocks.orderByMock).toHaveBeenCalled();
    const callArgs = mockDb._mocks.orderByMock.mock.calls[0];
    // The resolved column should be "date" (fallback), not the injected value
    expect(callArgs).toBeDefined();
    // Verify the injected string was never passed
    expect(JSON.stringify(callArgs)).not.toContain(injectedValue);
  });

  it("accepts allowed columns", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    for (const col of ["id", "subject", "sender", "recipient", "date", "read", "starred"] as const) {
      mockDb._mocks.orderByMock.mockClear();
      await instance.getEmails({ sortColumn: col, sortDirection: "ASC" });
      expect(mockDb._mocks.orderByMock).toHaveBeenCalled();
      const callArgs = mockDb._mocks.orderByMock.mock.calls[0];
      expect(callArgs).toBeDefined();
    }
  });

  it("defaults to DESC when sortDirection not ASC", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    await instance.getEmails({ sortColumn: "date", sortDirection: "DESC" as const });
    expect(mockDb._mocks.orderByMock).toHaveBeenCalled();
    mockDb._mocks.orderByMock.mockClear();
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

// ── countEmails / threaded counts ──────────────────────────────────

describe("MailboxDO countEmails", () => {
  it("builds parameterized WHERE for folder and thread", async () => {
    const sql = createMockSql(() => [{ total: 7 }] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.countEmails({ folder: "inbox", thread_id: "t1" })).toBe(7);
    const call = sql.calls[sql.calls.length - 1];
    expect(call.query).toContain("WHERE");
    expect(call.params).toContain("inbox");
    expect(call.params).toContain("t1");
  });

  it("returns 0 when no row", async () => {
    const sql = createMockSql(() => [] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.countEmails()).toBe(0);
  });

  it("no WHERE when no filters", async () => {
    const sql = createMockSql(() => [{ total: 3 }] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.countEmails()).toBe(3);
    expect(sql.calls[0].query).not.toContain("WHERE");
  });
});

describe("MailboxDO getThreadedEmails", () => {
  it("falls back to getEmails without folder", async () => {
    const { instance } = createMailboxDO();
    const mockDb = createMockDb();
    (instance as unknown as { db: unknown }).db = mockDb as unknown as typeof instance.db;
    await instance.getThreadedEmails({ limit: 500, page: 2 });
    // fallback path caps the limit like getEmails does
    expect(mockDb._mocks.limitMock).toHaveBeenCalledWith(100);
  });

  it("uses draft grouping query for draft folder", async () => {
    const sql = createMockSql(() => [
      { id: "d1", read: 1, starred: 0, sender: "a@ex.com" },
    ] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    const rows = await instance.getThreadedEmails({ folder: Folders.DRAFT });
    expect(sql.calls[sql.calls.length - 1].query).toContain("COALESCE(in_reply_to, id)");
    expect(rows[0]).toMatchObject({ id: "d1", read: true, starred: false, thread_count: 1 });
  });

  it("uses conversation threading for non-draft folders", async () => {
    const sql = createMockSql(() => [
      { id: "e1", read: 1, starred: 1, needs_reply: 1, has_draft: 1 },
    ] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    const rows = await instance.getThreadedEmails({ folder: "inbox" });
    expect(sql.calls[sql.calls.length - 1].query).toContain("normalized_subject");
    expect(rows[0]).toMatchObject({
      id: "e1",
      read: true,
      starred: true,
      needs_reply: true,
      has_draft: true,
    });
  });
});

describe("MailboxDO countThreadedEmails", () => {
  it("counts distinct draft groups in draft folder", async () => {
    const sql = createMockSql(() => [{ total: 4 }] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.countThreadedEmails(Folders.DRAFT)).toBe(4);
    expect(sql.calls[sql.calls.length - 1].query).toContain("COALESCE(in_reply_to, id)");
  });

  it("counts distinct conversations otherwise", async () => {
    const sql = createMockSql(() => [{ total: 9 }] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.countThreadedEmails("inbox")).toBe(9);
    expect(sql.calls[sql.calls.length - 1].query).toContain("COUNT(DISTINCT conversation_id)");
  });
});

// ── Single email operations ────────────────────────────────────────

describe("MailboxDO single email ops", () => {
  function singleRowDb(row: unknown, attachments: unknown[] = [], extra: Record<string, unknown> = {}) {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ get: vi.fn(() => row), all: vi.fn(() => attachments) })),
        })),
      })),
      update: vi.fn(),
      delete: vi.fn(),
      ...extra,
    };
  }

  it("getEmail returns null when not found", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = singleRowDb(undefined) as unknown as typeof instance.db;
    expect(await instance.getEmail("missing")).toBeNull();
  });

  it("getEmail returns email with boolean flags and attachments", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = singleRowDb(
      { id: "e1", read: 1, starred: 0 },
      [{ id: "att1" }],
    ) as unknown as typeof instance.db;
    const email = await instance.getEmail("e1");
    expect(email).toMatchObject({ id: "e1", read: true, starred: false, attachments: [{ id: "att1" }] });
  });

  it("getThreadEmails returns [] for empty thread", async () => {
    const sql = createMockSql(() => [] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.getThreadEmails("t-none")).toEqual([]);
  });

  it("getThreadEmails groups attachments per email", async () => {
    const sql = createMockSql((q) => {
      if (q.includes("FROM attachments")) {
        return [
          { id: "att1", email_id: "e1" },
          { id: "att2", email_id: "e2" },
        ] as unknown as unknown[];
      }
      return [
        { id: "e1", read: 1, starred: 0 },
        { id: "e2", read: 0, starred: 1 },
      ] as unknown as unknown[];
    });
    const { instance } = createMailboxDO(sql.exec);
    const emails = await instance.getThreadEmails("t1");
    expect(emails).toHaveLength(2);
    expect(emails[0]).toMatchObject({ id: "e1", read: true, attachments: [{ id: "att1" }] });
    expect(emails[1]).toMatchObject({ id: "e2", starred: true, attachments: [{ id: "att2" }] });
  });

  it("updateEmail applies read/starred and returns refreshed email", async () => {
    const runMock = vi.fn();
    const db = singleRowDb({ id: "e1", read: 1, starred: 0 });
    db.update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => ({ run: runMock })) })) }));
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = db as unknown as typeof instance.db;
    const email = await instance.updateEmail("e1", { read: true, starred: false });
    expect(runMock).toHaveBeenCalled();
    expect(email).toMatchObject({ id: "e1", read: true });
  });

  it("updateEmail with no fields skips write and returns current", async () => {
    const db = singleRowDb(null);
    const updateSpy = vi.fn();
    db.update = updateSpy;
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = db as unknown as typeof instance.db;
    await instance.updateEmail("e1", {});
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("markThreadRead updates and returns confirmation", async () => {
    const sql = createMockSql(() => [] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.markThreadRead("t1")).toEqual({ threadId: "t1", markedRead: true });
    expect(sql.calls[sql.calls.length - 1].query).toContain("SET read = 1");
  });

  it("deleteEmail returns null when not found", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = singleRowDb(undefined) as unknown as typeof instance.db;
    expect(await instance.deleteEmail("missing")).toBeNull();
  });

  it("deleteEmail returns attachment list after deleting", async () => {
    const deleteRun = vi.fn();
    const db = singleRowDb({ id: "e1" }, [{ id: "att1", filename: "f.txt" }]);
    db.delete = vi.fn(() => ({ where: vi.fn(() => ({ run: deleteRun })) }));
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = db as unknown as typeof instance.db;
    expect(await instance.deleteEmail("e1")).toEqual([{ id: "att1", filename: "f.txt" }]);
    expect(deleteRun).toHaveBeenCalled();
  });

  it("getAttachment returns attachment or null", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = singleRowDb({ id: "att1" }) as unknown as typeof instance.db;
    expect(await instance.getAttachment("att1")).toEqual({ id: "att1" });
    (instance as unknown as { db: unknown }).db = singleRowDb(undefined) as unknown as typeof instance.db;
    expect(await instance.getAttachment("missing")).toBeNull();
  });
});

// ── Folder CRUD ────────────────────────────────────────────────────

describe("MailboxDO folder CRUD", () => {
  function foldersDb(config: {
    folderGet?: unknown;
    insertGet?: unknown;
    insertError?: Error;
    updateGet?: unknown;
    selectGet?: unknown;
  }) {
    return {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ get: vi.fn(() => config.selectGet ?? config.folderGet) })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(() => ({
            get: vi.fn(() => {
              if (config.insertError) throw config.insertError;
              return config.insertGet;
            }),
          })),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(() => ({ get: vi.fn(() => config.updateGet) })) })),
        })),
      })),
      delete: vi.fn(() => ({ where: vi.fn(() => ({ run: vi.fn() })) })),
    };
  }

  it("getFolders returns folders with unread counts", async () => {
    const db = foldersDb({});
    db.select = vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({ groupBy: vi.fn(() => ({ all: vi.fn(() => [
          { id: "inbox", name: "Inbox", unreadCount: 3 },
        ]) })) })),
      })),
    }));
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = db as unknown as typeof instance.db;
    expect(await instance.getFolders()).toEqual([{ id: "inbox", name: "Inbox", unreadCount: 3 }]);
  });

  it("createFolder returns folder with zero unread", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = foldersDb({
      insertGet: { id: "proj", name: "Project" },
    }) as unknown as typeof instance.db;
    expect(await instance.createFolder("proj", "Project")).toEqual({
      id: "proj",
      name: "Project",
      unreadCount: 0,
    });
  });

  it("createFolder returns null on UNIQUE constraint", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = foldersDb({
      insertError: new Error("UNIQUE constraint failed: folders.id"),
    }) as unknown as typeof instance.db;
    expect(await instance.createFolder("proj", "Project")).toBeNull();
  });

  it("createFolder rethrows non-unique errors", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = foldersDb({
      insertError: new Error("disk I/O error"),
    }) as unknown as typeof instance.db;
    await expect(instance.createFolder("proj", "Project")).rejects.toThrow(/disk I\/O/);
  });

  it("updateFolder returns updated folder or null", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = foldersDb({
      updateGet: { id: "proj", name: "Renamed" },
    }) as unknown as typeof instance.db;
    expect(await instance.updateFolder("proj", "Renamed")).toEqual({ id: "proj", name: "Renamed" });
    (instance as unknown as { db: unknown }).db = foldersDb({}) as unknown as typeof instance.db;
    // drizzle .get() returns undefined (falsy) when no row matches
    expect(await instance.updateFolder("missing", "x")).toBeUndefined();
  });

  it("deleteFolder deletes deletable folder", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = foldersDb({
      selectGet: { is_deletable: 1 },
    }) as unknown as typeof instance.db;
    expect(await instance.deleteFolder("custom")).toBe(true);
  });

  it("deleteFolder returns false when folder missing", async () => {
    const { instance } = createMailboxDO();
    (instance as unknown as { db: unknown }).db = foldersDb({}) as unknown as typeof instance.db;
    expect(await instance.deleteFolder("ghost")).toBe(false);
  });
});

// ── Search filter coverage (#buildSearchConditions branches) ───────

describe("MailboxDO search filter conditions", () => {
  it("builds params for every filter type", async () => {
    const sql = createMockSql(() => [] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    await instance.searchEmails({
      query: "hello",
      from: "alice@ex.com",
      to: "bob@ex.com",
      subject: "pricing",
      date_start: "2026-01-01",
      date_end: "2026-12-31",
      is_read: false,
      is_starred: true,
      has_attachment: true,
      folder: "inbox",
    });
    const call = sql.calls[sql.calls.length - 1];
    expect(call.query).toContain("sender LIKE");
    expect(call.query).toContain("recipient LIKE");
    expect(call.query).toContain("subject LIKE");
    expect(call.query).toContain("date >=");
    expect(call.query).toContain("date <=");
    expect(call.query).toContain("read = ");
    expect(call.query).toContain("starred = ");
    expect(call.query).toContain("attachments");
    // all values are parameters, never interpolated
    expect(call.params).toContain("%hello%");
    expect(call.params).toContain("%alice@ex.com%");
    expect(call.params).toContain("2026-01-01");
    expect(call.params).toContain(0); // is_read=false -> 0
    expect(call.params).toContain(1); // is_starred=true -> 1
  });

  it("countSearchResults omits table alias prefix", async () => {
    const sql = createMockSql(() => [{ total: 2 }] as unknown as unknown[]);
    const { instance } = createMailboxDO(sql.exec);
    expect(await instance.countSearchResults({ query: "hi" })).toBe(2);
    const call = sql.calls[sql.calls.length - 1];
    expect(call.query).not.toContain("e.");
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
