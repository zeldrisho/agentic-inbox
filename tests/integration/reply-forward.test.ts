// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi } from "vite-plus/test";
import { app } from "workers/index";

// ── Mock helpers (mirror api.test.ts) ──────────────────────────────

function mockBucket() {
  const store = new Map<string, string>();
  return {
    head: vi.fn(async (key: string) => (store.has(key) ? { key } : null)),
    get: vi.fn(async (key: string) => {
      const v = store.get(key);
      return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
    }),
    put: vi.fn(async (key: string, val: string) => {
      store.set(key, val);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async () => ({
      objects: [...store.keys()].filter((k) => k.startsWith("mailboxes/")).map((k) => ({ key: k })),
      truncated: false,
    })),
    _store: store,
  };
}

function mockMailboxStub(overrides: Record<string, unknown> = {}) {
  return {
    getEmails: vi.fn(async () => []),
    countEmails: vi.fn(async () => 0),
    getEmail: vi.fn(async () => null),
    checkSendRateLimit: vi.fn(async () => null),
    createEmail: vi.fn(async () => {}),
    deleteEmail: vi.fn(async () => []),
    moveEmail: vi.fn(async () => true),
    getFolders: vi.fn(async () => []),
    markThreadRead: vi.fn(async () => {}),
    updateEmail: vi.fn(async () => null),
    ...overrides,
  };
}

function mockEnv(bucket: ReturnType<typeof mockBucket>, stub: ReturnType<typeof mockMailboxStub>) {
  return {
    BUCKET: bucket as unknown as R2Bucket,
    MAILBOX: {
      idFromName: vi.fn((n: string) => n as unknown as DurableObjectId),
      get: vi.fn(() => stub as unknown as DurableObjectStub<unknown>),
    },
    EMAIL: { send: vi.fn(async () => {}) } as unknown as SendEmail,
    AI: { run: vi.fn(async () => ({ response: "clean" })) } as unknown as Ai,
    EMAIL_AGENT: { idFromName: vi.fn((n: string) => n), get: vi.fn(() => ({ fetch: vi.fn() })) },
    DOMAINS: "example.com",
    EMAIL_ADDRESSES: [] as unknown as string[],
  } as unknown as Cloudflare.Env;
}

async function requestApp(
  env: Cloudflare.Env,
  method: string,
  path: string,
  body?: unknown,
) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request(`http://localhost${path}`, init);
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  // SAFETY: app.fetch signature is (request, env, ctx)
  const res = await (
    app as unknown as { fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response> }
  ).fetch(req, env, ctx);
  return { res, ctx };
}

const ORIGINAL = {
  id: "e1",
  subject: "Hello",
  sender: "bob@example.com",
  recipient: "alice@example.com",
  date: "2026-01-01T00:00:00.000Z",
  read: true,
  starred: false,
  body: "<p>Original</p>",
  thread_id: "t1",
  message_id: "msg-1",
  email_references: JSON.stringify(["msg-0"]),
};

const VALID_BODY = {
  to: "bob@example.com",
  from: "alice@example.com",
  subject: "Re: Hello",
  html: "<p>Hi</p>",
};

function setupMailbox(bucket: ReturnType<typeof mockBucket>) {
  bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({ fromName: "Alice" }));
}

// ── Reply ──────────────────────────────────────────────────────────

describe("POST /emails/:id/reply", () => {
  it("404 when original email not found", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => null) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/missing/reply",
      VALID_BODY,
    );
    expect(res.status).toBe(404);
  });

  it("400 when sender does not match mailbox", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/e1/reply",
      { ...VALID_BODY, from: "evil@example.com" },
    );
    expect(res.status).toBe(400);
  });

  it("429 when rate limited", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({
      getEmail: vi.fn(async () => ORIGINAL),
      checkSendRateLimit: vi.fn(async () => "Rate limit exceeded: max 20 emails per hour"),
    });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/e1/reply",
      VALID_BODY,
    );
    expect(res.status).toBe(429);
  });

  it("202 sends reply, marks thread read, and queues delivery", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const { res, ctx } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/e1/reply",
      VALID_BODY,
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("sent");
    expect(stub.markThreadRead).toHaveBeenCalledWith("t1");
    expect(ctx.waitUntil).toHaveBeenCalled();
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[0]).toBe("sent");
    expect(created[1].in_reply_to).toBe("msg-1");
  });

  it("resolves draft original via in_reply_to before threading", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const draftEmail = {
      ...ORIGINAL,
      id: "d1",
      folder_id: "draft",
      in_reply_to: "e1",
      thread_id: "draft-thread",
    };
    const stub = mockMailboxStub({
      getEmail: vi.fn(async (id: string) => (id === "d1" ? draftEmail : ORIGINAL)),
    });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/d1/reply",
      VALID_BODY,
    );
    expect(res.status).toBe(202);
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    // thread_id resolved from the real original (e1 -> t1), not the draft's own
    expect(created[1].thread_id).toBe("t1");
    expect(created[1].in_reply_to).toBe("msg-1");
  });
});

// ── Forward ────────────────────────────────────────────────────────

describe("POST /emails/:id/forward", () => {
  it("404 when original email not found", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => null) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/missing/forward",
      VALID_BODY,
    );
    expect(res.status).toBe(404);
  });

  it("400 when sender does not match mailbox", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/e1/forward",
      { ...VALID_BODY, from: "evil@example.com" },
    );
    expect(res.status).toBe(400);
  });

  it("429 when rate limited", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({
      getEmail: vi.fn(async () => ORIGINAL),
      checkSendRateLimit: vi.fn(async () => "Rate limit exceeded"),
    });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/e1/forward",
      VALID_BODY,
    );
    expect(res.status).toBe(429);
  });

  it("202 forwards email with fresh thread id", async () => {
    const bucket = mockBucket();
    setupMailbox(bucket);
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const { res, ctx } = await requestApp(
      env,
      "POST",
      "/api/v1/mailboxes/alice@example.com/emails/e1/forward",
      VALID_BODY,
    );
    expect(res.status).toBe(202);
    expect(ctx.waitUntil).toHaveBeenCalled();
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[0]).toBe("sent");
    expect(created[1].in_reply_to).toBeNull();
    expect(created[1].thread_id).toBe(created[1].id);
  });
});
