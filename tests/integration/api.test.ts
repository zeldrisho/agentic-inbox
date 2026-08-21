// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { app } from "workers/index";

// Mock R2 bucket
function mockBucket(overrides: Partial<Record<string, unknown>> = {}) {
  const store = new Map<string, string>();
  const head = vi.fn(async (key: string) => (store.has(key) ? { key } : null));
  const get = vi.fn(async (key: string) => {
    const v = store.get(key);
    return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
  });
  const put = vi.fn(async (key: string, val: string) => { store.set(key, val); });
  const del = vi.fn(async (key: string) => { store.delete(key); });
  const list = vi.fn(async () => ({ objects: [...store.keys()].filter((k) => k.startsWith("mailboxes/")).map((k) => ({ key: k })), truncated: false }));
  // prefill store from overrides._store if needed
  if ((overrides as unknown as { _store?: Map<string,string> })._store) {
    for (const [k,v] of (overrides as unknown as { _store: Map<string,string> })._store) store.set(k,v);
  }
  return { head, get, put, delete: del, list, _store: store };
}

function mockMailboxStub(overrides: Record<string, unknown> = {}) {
  return {
    getEmails: vi.fn(async () => []),
    countEmails: vi.fn(async () => 0),
    getThreadedEmails: vi.fn(async () => []),
    countThreadedEmails: vi.fn(async () => 0),
    getEmail: vi.fn(async () => null),
    getAttachment: vi.fn(async () => null),
    checkSendRateLimit: vi.fn(async () => null),
    createEmail: vi.fn(async () => {}),
    deleteEmail: vi.fn(async () => []),
    moveEmail: vi.fn(async () => true),
    getFolders: vi.fn(async () => []),
    createFolder: vi.fn(async () => ({ id: "x", name: "x", unreadCount: 0 })),
    updateFolder: vi.fn(async () => null),
    deleteFolder: vi.fn(async () => false),
    getThreadEmails: vi.fn(async () => []),
    markThreadRead: vi.fn(async () => {}),
    searchEmails: vi.fn(async () => []),
    countSearchResults: vi.fn(async () => 0),
    findThreadBySubject: vi.fn(async () => null),
    updateEmail: vi.fn(async () => null),
    ...overrides,
  };
}

function mockEnv(bucket: ReturnType<typeof mockBucket>, mailboxStub?: ReturnType<typeof mockMailboxStub>) {
  const stub = mailboxStub || mockMailboxStub();
  return {
    BUCKET: bucket as unknown as R2Bucket,
    MAILBOX: {
      idFromName: vi.fn((n: string) => n as unknown as DurableObjectId),
      get: vi.fn(() => stub as unknown as DurableObjectStub<unknown>),
    },
    EMAIL: { send: vi.fn(async () => {}) } as unknown as SendEmail,
    AI: { run: vi.fn(async () => ({ response: "clean" })) } as unknown as Ai,
    EMAIL_AGENT: { idFromName: vi.fn((n: string) => n), get: vi.fn(() => ({ fetch: vi.fn() })) } as unknown as DurableObjectNamespace,
    DOMAINS: "example.com",
    EMAIL_ADDRESSES: [] as unknown as string[],
    _stub: stub,
  } as unknown as EnvWithStub;
}

type EnvWithStub = Env & { _stub: ReturnType<typeof mockMailboxStub> };
type Env = Cloudflare.Env & { BUCKET: R2Bucket; MAILBOX: DurableObjectNamespace; EMAIL: SendEmail; AI: Ai; EMAIL_AGENT: DurableObjectNamespace; DOMAINS: string; EMAIL_ADDRESSES: string[] };

async function requestApp(env: EnvWithStub, method: string, path: string, body?: unknown, headers: Record<string,string> = {}) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request(`http://localhost${path}`, init);
  // Hono app.fetch expects (request, env, executionCtx)
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  // SAFETY: app.fetch signature is (req, env, ctx)
  const res = await (app as unknown as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(req, env as unknown as Cloudflare.Env, ctx);
  return { res, ctx };
}

describe("POST /api/v1/mailboxes", () => {
  it("403 when EMAIL_ADDRESSES allowlist rejects", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    env.EMAIL_ADDRESSES = ["allowed@example.com"];
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes", { email: "other@example.com", name: "Other" });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/restricted/i);
  });

  it("409 when mailbox already exists", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/existing@example.com.json", JSON.stringify({ fromName: "Existing" }));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes", { email: "existing@example.com", name: "Existing" });
    expect(res.status).toBe(409);
  });

  it("201 creates mailbox", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes", { email: "new@example.com", name: "New" });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };
    expect(body.id).toBe("new@example.com");
  });

  it("400 on invalid email", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes", { email: "not-an-email", name: "X" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/mailboxes/:id/emails", () => {
  it("400 when from does not match mailbox", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails", {
      to: "bob@example.com", from: "evil@example.com", subject: "hi", html: "<p>hi</p>",
    });
    expect(res.status).toBe(400);
  });

  it("429 when rate limited", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ checkSendRateLimit: vi.fn(async () => "Rate limit exceeded: max 20 emails per hour per mailbox") });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails", {
      to: "bob@example.com", from: "alice@example.com", subject: "hi", html: "<p>hi</p>",
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toHaveProperty("error");
  });

  it("202 on valid send", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ checkSendRateLimit: vi.fn(async () => null) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails", {
      to: "bob@example.com", from: "alice@example.com", subject: "hi", html: "<p>hi</p>",
    });
    expect(res.status).toBe(202);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("sent");
  });

  it("400 when html and text missing", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails", {
      to: "bob@example.com", from: "alice@example.com", subject: "hi",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /attachments sanitization", () => {
  it("sanitizes filename in Content-Disposition", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({
      getAttachment: vi.fn(async () => ({ id: "att1", filename: 'evil"\r\n.txt', mimetype: "text/plain" })),
    });
    const env = mockEnv(bucket, stub);
    // Mock R2 get for attachment blob
    (bucket as unknown as { get: ReturnType<typeof vi.fn> }).get = vi.fn(async (key: string) => {
      if (key.includes("attachments/")) return { body: new ReadableStream() } as unknown as R2ObjectBody;
      const v = bucket._store.get(key);
      return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
    }) as unknown as typeof bucket.get;
    // Need to mock BUCKET.get for R2 file: add a handler that returns a body for attachment key
    const origGet = bucket.get;
    bucket.get = vi.fn(async (key: string) => {
      if (key.startsWith("attachments/")) {
        return { body: "filecontent", headers: new Headers() } as unknown as R2ObjectBody;
      }
      if (key.startsWith("mailboxes/")) {
        const v = bucket._store.get(key);
        return v ? ({ json: async () => JSON.parse(v), headers: new Headers() } as unknown as R2ObjectBody) : null;
      }
      return null;
    }) as unknown as typeof bucket.get;

    // Also need head for requireMailbox
    bucket.head = vi.fn(async (key: string) => {
      if (key === "mailboxes/alice@example.com.json") return { key } as unknown as R2Object;
      return null;
    });

    const req = new Request("http://localhost/api/v1/mailboxes/alice@example.com/emails/email1/attachments/att1");
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const res = await (app as unknown as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(req, env as unknown as Cloudflare.Env, ctx);
    // Should be 200 with sanitized disposition
    expect(res.status).toBe(200);
    const disp = res.headers.get("Content-Disposition") || "";
    expect(disp).not.toContain('"evil"');
    expect(disp).toContain("attachment");
  });

  it("404 when attachment not found", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ getAttachment: vi.fn(async () => null) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/alice@example.com/emails/e1/attachments/missing");
    expect(res.status).toBe(404);
  });
});

describe("requireMailbox 404", () => {
  it("returns 404 for missing mailbox", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/ghost@example.com/emails");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it("returns 404 for missing attachment mailbox", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/ghost@example.com/folders");
    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  it("allows same-origin (no Origin header) — no CORS block", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const req = new Request("http://localhost/api/v1/config", { headers: {} });
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const res = await (app as unknown as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(req, env as unknown as Cloudflare.Env, ctx);
    expect(res.status).toBe(200);
    // No Access-Control-Allow-Origin needed for same-origin
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("allows localhost origin", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const req = new Request("http://localhost/api/v1/config", { headers: { Origin: "http://localhost:5173" } });
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const res = await (app as unknown as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(req, env as unknown as Cloudflare.Env, ctx);
    // Hono cors will set header for allowed origin
    // Our cors handler allows localhost, so should reflect it
    const allowOrigin = res.headers.get("Access-Control-Allow-Origin");
    expect(allowOrigin).toBe("http://localhost:5173");
  });

  it("blocks evil cross-origin", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const req = new Request("http://localhost/api/v1/config", { headers: { Origin: "https://evil.com" } });
    const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
    const res = await (app as unknown as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(req, env as unknown as Cloudflare.Env, ctx);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("GET /api/v1/models cache/refresh", () => {
  it("returns models payload", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    // Mock fetch for catalog - intercept global fetch
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => new Response("no models here", { status: 200 })) as unknown as typeof fetch;
      const { res } = await requestApp(env, "GET", "/api/v1/models");
      expect(res.status).toBe(200);
      const body = await res.json() as { models: unknown[]; source: string };
      expect(Array.isArray(body.models)).toBe(true);
      expect(body.models.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("refresh=1 bypasses cache", async () => {
    const bucket = mockBucket();
    // pre-populate cache key
    bucket._store.set("cache/models.json", JSON.stringify({ cachedAt: new Date().toISOString(), models: [{ id: "old" }], source: "fallback" }));
    const env = mockEnv(bucket);
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
      const { res } = await requestApp(env, "GET", "/api/v1/models?refresh=1");
      expect(res.status).toBe(200);
      const body = await res.json() as { source: string; models: unknown[] };
      // refresh should still return something (fallback)
      expect(body.models).toBeDefined();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("uses R2 cache when not expired", async () => {
    const bucket = mockBucket();
    const cached = { cachedAt: new Date().toISOString(), models: [{ id: "@cf/test/model", name: "test" }], source: "models/index.md" };
    bucket._store.set("cache/models.json", JSON.stringify(cached));
    const env = mockEnv(bucket);
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = vi.fn(async () => { throw new Error("Should not fetch when cached"); }) as unknown as typeof fetch;
      const { res } = await requestApp(env, "GET", "/api/v1/models");
      // Should return cached without needing fetch
      expect(res.status).toBe(200);
      const body = await res.json() as typeof cached;
      expect(body.models[0].id).toBe("@cf/test/model");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("GET /api/v1/config", () => {
  it("returns domains and emailAddresses", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    env.DOMAINS = "example.com, other.com";
    env.EMAIL_ADDRESSES = ["a@example.com"];
    const { res } = await requestApp(env, "GET", "/api/v1/config");
    expect(res.status).toBe(200);
    const body = await res.json() as { domains: string[]; emailAddresses: string[] };
    expect(body.domains).toEqual(["example.com", "other.com"]);
    expect(body.emailAddresses).toEqual(["a@example.com"]);
  });
});

// ── Additional route coverage (emails, drafts, folders, threads, search) ──

describe("GET /api/v1/mailboxes", () => {
  it("lists mailboxes with name fallback to id", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({ fromName: "Alice" }));
    bucket._store.set("mailboxes/bob@example.com.json", JSON.stringify({ fromName: "Bob" }));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes");
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; name: string }[];
    expect(body.map((m) => m.id).sort()).toEqual(["alice@example.com", "bob@example.com"]);
    for (const m of body) expect(m.name).toBe(m.id);
  });
});

describe("GET/PUT/DELETE /api/v1/mailboxes/:id", () => {
  it("404 when mailbox missing", async () => {
    const bucket = mockBucket();
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/ghost@example.com");
    expect(res.status).toBe(404);
  });

  it("returns settings on GET", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({ fromName: "Alice" }));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/alice@example.com");
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; settings: { fromName: string } };
    expect(body.id).toBe("alice@example.com");
    expect(body.settings.fromName).toBe("Alice");
  });

  it("PUT updates settings, 404 when missing", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({ fromName: "Alice" }));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "PUT", "/api/v1/mailboxes/alice@example.com", {
      settings: { fromName: "Updated" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { settings: { fromName: string } };
    expect(body.settings.fromName).toBe("Updated");

    const { res: res404 } = await requestApp(env, "PUT", "/api/v1/mailboxes/ghost@example.com", {
      settings: {},
    });
    expect(res404.status).toBe(404);
  });

  it("DELETE returns 204 and 404 when missing", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "DELETE", "/api/v1/mailboxes/alice@example.com");
    expect(res.status).toBe(204);
    expect(bucket.delete).toHaveBeenCalled();

    const { res: res404 } = await requestApp(env, "DELETE", "/api/v1/mailboxes/alice@example.com");
    expect(res404.status).toBe(404);
  });
});

describe("POST /api/v1/mailboxes/:id/drafts", () => {
  function setupDrafts(stubOverrides: Record<string, unknown> = {}) {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub(stubOverrides);
    return { env: mockEnv(bucket, stub), stub };
  }

  it("201 creates a draft in the draft folder", async () => {
    const { env, stub } = setupDrafts({ deleteEmail: vi.fn(async () => []) });
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/drafts", {
      to: "bob@example.com",
      subject: "Hi",
      body: "hello draft",
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { status: string; subject: string };
    expect(body.status).toBe("draft");
    expect(body.subject).toBe("Hi");
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[0]).toBe("draft");
    expect(created[1].sender).toBe("alice@example.com");
    expect(created[1].recipient).toBe("bob@example.com");
  });

  it("deletes prior draft when draft_id provided (edit flow)", async () => {
    const deleteEmail = vi.fn(async () => []);
    const { env, stub } = setupDrafts({ deleteEmail });
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/drafts", {
      body: "updated",
      draft_id: "old-draft",
    });
    expect(res.status).toBe(201);
    expect(deleteEmail).toHaveBeenCalledWith("old-draft");
    expect(stub.createEmail).toHaveBeenCalled();
  });
});

describe("GET/PUT/DELETE emails by id + move + threads", () => {
  function setupStub(overrides: Record<string, unknown> = {}) {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub(overrides);
    return { env: mockEnv(bucket, stub), stub };
  }

  it("GET email returns 404 when not found", async () => {
    const { env } = setupStub();
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/alice@example.com/emails/missing");
    expect(res.status).toBe(404);
  });

  it("GET email returns email when found", async () => {
    const { env } = setupStub({
      getEmail: vi.fn(async () => ({ id: "e1", read: true, starred: false })),
    });
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/alice@example.com/emails/e1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "e1" });
  });

  it("PUT email updates flags, 404 when not found", async () => {
    const { env, stub } = setupStub({
      updateEmail: vi.fn(async () => ({ id: "e1", read: true })),
    });
    const { res } = await requestApp(env, "PUT", "/api/v1/mailboxes/alice@example.com/emails/e1", {
      read: true,
    });
    expect(res.status).toBe(200);
    expect(stub.updateEmail).toHaveBeenCalledWith("e1", { read: true, starred: undefined });

    const { env: env2 } = setupStub({ updateEmail: vi.fn(async () => null) });
    const { res: res404 } = await requestApp(env2, "PUT", "/api/v1/mailboxes/alice@example.com/emails/e1", {
      read: true,
    });
    expect(res404.status).toBe(404);
  });

  it("DELETE email removes attachments and returns 204, 404 when missing", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({
      deleteEmail: vi.fn(async () => [{ id: "att1", filename: "f.txt" }]),
    });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "DELETE", "/api/v1/mailboxes/alice@example.com/emails/e1");
    expect(res.status).toBe(204);
    expect(bucket.delete).toHaveBeenCalledWith(["attachments/e1/att1/f.txt"]);

    const { env: env2 } = setupStub({ deleteEmail: vi.fn(async () => null) });
    const { res: res404 } = await requestApp(env2, "DELETE", "/api/v1/mailboxes/alice@example.com/emails/e1");
    expect(res404.status).toBe(404);
  });

  it("POST move succeeds or 400 for bad folder", async () => {
    const { env } = setupStub({ moveEmail: vi.fn(async () => false) });
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails/e1/move", {
      folderId: "bad",
    });
    expect(res.status).toBe(400);

    const { env: env2 } = setupStub({ moveEmail: vi.fn(async () => true) });
    const { res: ok } = await requestApp(env2, "POST", "/api/v1/mailboxes/alice@example.com/emails/e1/move", {
      folderId: "archive",
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "moved" });
  });

  it("thread endpoints return emails / mark read", async () => {
    const { env, stub } = setupStub({
      getThreadEmails: vi.fn(async () => [{ id: "e1" }]),
    });
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/alice@example.com/threads/t1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "e1" }]);

    const { res: readRes } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/threads/t1/read",
    );
    expect(readRes.status).toBe(200);
    expect(await readRes.json()).toEqual({ status: "marked_read" });
    expect(stub.markThreadRead).toHaveBeenCalledWith("t1");
  });

  it("GET emails supports threaded mode and plain list", async () => {
    const { env, stub } = setupStub({
      getThreadedEmails: vi.fn(async () => [{ id: "t1" }]),
      countThreadedEmails: vi.fn(async () => 5),
      getEmails: vi.fn(async () => [{ id: "e1" }]),
      countEmails: vi.fn(async () => 2),
    });
    const { res } = await requestApp(
      env,
      "GET",
      "/api/v1/mailboxes/alice@example.com/emails?folder=inbox&threaded=true",
    );
    const body = await res.json() as { emails: unknown[]; totalCount: number };
    expect(body).toEqual({ emails: [{ id: "t1" }], totalCount: 5 });

    const { res: plain } = await requestApp(
      env,
      "GET",
      "/api/v1/mailboxes/alice@example.com/emails?folder=inbox",
    );
    const plainBody = await plain.json() as { emails: unknown[]; totalCount: number };
    expect(plainBody).toEqual({ emails: [{ id: "e1" }], totalCount: 2 });

    // no folder -> raw array response
    const { res: raw } = await requestApp(env, "GET", "/api/v1/mailboxes/alice@example.com/emails");
    expect(await raw.json()).toEqual([{ id: "e1" }]);
  });
});

describe("folder CRUD routes", () => {
  function setupFolders(stubOverrides: Record<string, unknown> = {}) {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub(stubOverrides);
    return { env: mockEnv(bucket, stub), stub };
  }

  it("GET lists folders", async () => {
    const { env } = setupFolders({ getFolders: vi.fn(async () => [{ id: "inbox", name: "Inbox" }]) });
    const { res } = await requestApp(env, "GET", "/api/v1/mailboxes/alice@example.com/folders");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "inbox", name: "Inbox" }]);
  });

  it("POST creates folder, 400 on empty slug, 409 on duplicate", async () => {
    const { env } = setupFolders({
      createFolder: vi.fn(async () => ({ id: "proj", name: "Project" })),
    });
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/folders", {
      name: "Project!",
    });
    expect(res.status).toBe(201);

    const { res: bad } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/folders", {
      name: "!!!",
    });
    expect(bad.status).toBe(400);

    const { env: dupEnv } = setupFolders({ createFolder: vi.fn(async () => null) });
    const { res: conflict } = await requestApp(dupEnv, "POST", "/api/v1/mailboxes/alice@example.com/folders", {
      name: "dup",
    });
    expect(conflict.status).toBe(409);
  });

  it("PUT renames folder, 404 when missing", async () => {
    const { env } = setupFolders({ updateFolder: vi.fn(async () => ({ id: "proj", name: "New" })) });
    const { res } = await requestApp(env, "PUT", "/api/v1/mailboxes/alice@example.com/folders/proj", {
      name: "New",
    });
    expect(res.status).toBe(200);

    const { env: missEnv } = setupFolders({ updateFolder: vi.fn(async () => null) });
    const { res: miss } = await requestApp(missEnv, "PUT", "/api/v1/mailboxes/alice@example.com/folders/x", {
      name: "New",
    });
    expect(miss.status).toBe(404);
  });

  it("DELETE removes folder, 400 when not deletable", async () => {
    const { env } = setupFolders({ deleteFolder: vi.fn(async () => true) });
    const del = await requestApp(env, "DELETE", "/api/v1/mailboxes/alice@example.com/folders/proj");
    expect(del.res.status).toBe(204);

    const { env: noEnv } = setupFolders({ deleteFolder: vi.fn(async () => false) });
    const denied = await requestApp(noEnv, "DELETE", "/api/v1/mailboxes/alice@example.com/folders/inbox");
    expect(denied.res.status).toBe(400);
  });
});

describe("GET search route", () => {
  it("returns emails and totalCount from DO search", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({
      searchEmails: vi.fn(async () => [{ id: "e1" }]),
      countSearchResults: vi.fn(async () => 1),
    });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "GET",
      "/api/v1/mailboxes/alice@example.com/search?query=pricing&is_read=true&limit=10&page=2",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ emails: [{ id: "e1" }], totalCount: 1 });
    expect(stub.searchEmails).toHaveBeenCalledWith(
      expect.objectContaining({ query: "pricing", is_read: true, limit: 10, page: 2 }),
    );
  });
});
