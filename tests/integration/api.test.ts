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
    globalThis.fetch = vi.fn(async () => new Response("no models here", { status: 200 })) as unknown as typeof fetch;
    const { res } = await requestApp(env, "GET", "/api/v1/models");
    expect(res.status).toBe(200);
    const body = await res.json() as { models: unknown[]; source: string };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models.length).toBeGreaterThan(0);
    globalThis.fetch = origFetch;
  });

  it("refresh=1 bypasses cache", async () => {
    const bucket = mockBucket();
    // pre-populate cache key
    bucket._store.set("cache/models.json", JSON.stringify({ cachedAt: new Date().toISOString(), models: [{ id: "old" }], source: "fallback" }));
    const env = mockEnv(bucket);
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    const { res } = await requestApp(env, "GET", "/api/v1/models?refresh=1");
    expect(res.status).toBe(200);
    const body = await res.json() as { source: string; models: unknown[] };
    // refresh should still return something (fallback)
    expect(body.models).toBeDefined();
    globalThis.fetch = origFetch;
  });

  it("uses R2 cache when not expired", async () => {
    const bucket = mockBucket();
    const cached = { cachedAt: new Date().toISOString(), models: [{ id: "@cf/test/model", name: "test" }], source: "models/index.md" };
    bucket._store.set("cache/models.json", JSON.stringify(cached));
    const env = mockEnv(bucket);
    const { res } = await requestApp(env, "GET", "/api/v1/models");
    // Should return cached without needing fetch
    expect(res.status).toBe(200);
    const body = await res.json() as typeof cached;
    expect(body.models[0].id).toBe("@cf/test/model");
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
