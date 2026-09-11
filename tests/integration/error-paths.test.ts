// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Error-path and branch-gap coverage for `workers/index.ts` and
 * `workers/routes/reply-forward.ts` (docs/plan.md P2).
 *
 * Complements api.test.ts / reply-forward.test.ts with the failure branches
 * those happy-path suites leave uncovered: Zod validation errors surfacing as
 * 400s via `app.onError`, nullish-config fallbacks, search filter parsing,
 * and cc/bcc/from shape variants on the reply/forward routes.
 */

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { app, receiveEmail } from "workers/index";

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
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({
      objects: [...store.keys()]
        .filter((k) => k.startsWith("mailboxes/"))
        .map((k) => ({ key: k })),
      truncated: false,
    })),
    _store: store,
  };
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
    updateFolder: vi.fn(async () => ({ id: "x", name: "x" })),
    deleteFolder: vi.fn(async () => true),
    getThreadEmails: vi.fn(async () => []),
    markThreadRead: vi.fn(async () => {}),
    searchEmails: vi.fn(async () => []),
    countSearchResults: vi.fn(async () => 0),
    findThreadBySubject: vi.fn(async () => null),
    updateEmail: vi.fn(async () => null),
    destroy: vi.fn(async () => [] as { key: string }[]),
    listAttachmentKeys: vi.fn(async () => [] as { key: string }[]),
    replaceDraft: vi.fn(async () => true),
    updateDeliveryStatus: vi.fn(async () => {}),
    ...overrides,
  };
}

async function requestApp(env: unknown, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request(`http://localhost${path}`, init);
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
  const res = await (app as unknown as {
    fetch: (req: Request, env: unknown, ctx: unknown) => Promise<Response>;
  }).fetch(req, env, ctx);
  return { res };
}

describe("error paths: workers/index.ts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockEnv(bucket: ReturnType<typeof mockBucket>, stub = mockMailboxStub()) {
    return {
      BUCKET: bucket,
      MAILBOX: {
        idFromName: vi.fn((n: string) => n),
        get: vi.fn(() => stub),
      },
      EMAIL: { send: vi.fn(async () => {}) },
      AI: { run: vi.fn(async () => ({ response: "clean" })) },
      EMAIL_AGENT: {
        idFromName: vi.fn((n: string) => n),
        get: vi.fn(() => ({ destroy: vi.fn(async () => {}) })),
      },
      DOMAINS: "example.com",
      EMAIL_ADDRESSES: undefined,
      _stub: stub,
    };
  }

  it("returns 400 with issues when body fails schema validation (onError)", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const env = mockEnv(bucket);
    // `to` violates RecipientFieldSchema; SendEmailRequestSchema.parse throws inside the handler.
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails", {
      to: "not-an-email",
      from: "alice@example.com",
      subject: "hi",
      html: "<p>hi</p>",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBeTruthy();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("GET /config falls back to empty emailAddresses when EMAIL_ADDRESSES is undefined", async () => {
    const env = mockEnv(mockBucket());
    const { res } = await requestApp(env, "GET", "/api/v1/config");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { domains: string[]; emailAddresses: string[] };
    expect(body.emailAddresses).toEqual([]);
    expect(body.domains).toEqual(["example.com"]);
  });

  it("POST /mailboxes rejects an empty name with 400", async () => {
    const env = mockEnv(mockBucket());
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes", {
      email: "a@example.com",
      name: "",
    });
    expect(res.status).toBe(400);
  });

  it("GET search parses boolean filters into DO query options", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({
      searchEmails: vi.fn(async () => [{ id: "e1" }]),
      countSearchResults: vi.fn(async () => 7),
    });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(
      env,
      "GET",
      "/api/v1/mailboxes/alice@example.com/search?query=hello&from=bob&to=alice&subject=Re&date_start=2026-01-01&date_end=2026-12-31&is_read=true&is_starred=false&has_attachment=true&page=2&limit=10",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emails: unknown[]; totalCount: number };
    expect(body.totalCount).toBe(7);
    expect(stub.searchEmails).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "hello",
        folder: undefined,
        is_read: true,
        is_starred: false,
        has_attachment: true,
        page: 2,
        limit: 10,
      }),
    );
  });

  it("PUT email flags forwards both read and starred to updateEmail", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({
      updateEmail: vi.fn(async () => ({ id: "e1", read: true, starred: false })),
    });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "PUT", "/api/v1/mailboxes/alice@example.com/emails/e1", {
      read: true,
      starred: false,
    });
    expect(res.status).toBe(200);
    expect(stub.updateEmail).toHaveBeenCalledWith("e1", { read: true, starred: false });
  });

  it("receiveEmail stores inbound attachments, cc, and bcc", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/user@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub();
    const env = {
      BUCKET: bucket,
      MAILBOX: { idFromName: vi.fn((n: string) => n), get: vi.fn(() => stub) },
      EMAIL_AGENT: { idFromName: vi.fn((n: string) => n), get: vi.fn() },
      EMAIL_ADDRESSES: [],
      DOMAINS: "example.com",
    };
    const raw = [
      "From: sender@ex.com",
      "To: user@example.com",
      "Cc: ccdr@example.com",
      "Subject: with attachment",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="BOUND"',
      "",
      "--BOUND",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "hello body",
      "--BOUND",
      'Content-Type: text/plain; name="note.txt"',
      "Content-Disposition: attachment; filename=\"note.txt\"",
      "Content-Transfer-Encoding: base64",
      "",
      "aGVsbG8=",
      "--BOUND--",
      "",
    ].join("\r\n");
    const bytes = new TextEncoder().encode(raw);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;
    await receiveEmail(
      { raw: stream as unknown as ReadableStream, rawSize: bytes.length },
      env as unknown as Parameters<typeof receiveEmail>[1],
      ctx,
    );
    // Attachment blob stored in R2 under the per-email key scheme.
    const putKeys = bucket.put.mock.calls.map((c) => c[0] as string);
    expect(putKeys.some((k) => /^attachments\/[0-9a-f-]+\/[0-9a-f-]+\/note\.txt$/.test(k))).toBe(true);
    // Email row carries cc and the attachment metadata.
    const createCall = stub.createEmail.mock.calls[0] as unknown[] | undefined;
    const draftEmail = (createCall?.[1] ?? {}) as Record<string, unknown>;
    expect(draftEmail.cc).toBe("ccdr@example.com");
    expect(draftEmail.bcc).toBeNull();
    const attachments = (createCall?.[2] ?? []) as { filename: string }[];
    expect(attachments).toHaveLength(1);
    expect(attachments[0].filename).toBe("note.txt");
  });

  it("DELETE mailbox wipes the DO even when no blobs exist", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ destroy: vi.fn(async () => []) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "DELETE", "/api/v1/mailboxes/alice@example.com");
    expect(res.status).toBe(204);
    expect(stub.destroy).toHaveBeenCalled();
    expect(bucket.delete).toHaveBeenCalledWith(["mailboxes/alice@example.com.json", "deletions/alice%40example.com.json"]);
  });
});

describe("reply/forward recipient-shape branches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockEnv(bucket: ReturnType<typeof mockBucket>, stub = mockMailboxStub()) {
    return {
      BUCKET: bucket,
      MAILBOX: {
        idFromName: vi.fn((n: string) => n),
        get: vi.fn(() => stub),
      },
      EMAIL: { send: vi.fn(async () => {}) },
      AI: { run: vi.fn(async () => ({ response: "clean" })) },
      EMAIL_AGENT: { idFromName: vi.fn((n: string) => n), get: vi.fn() },
      DOMAINS: "example.com",
      EMAIL_ADDRESSES: [],
      _stub: stub,
    };
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
  };

  it("reply 202 with array cc/bcc, object from, and text-only body", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const sendSpy = vi.spyOn(env.EMAIL, "send");
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails/e1/reply", {
      to: ["bob@example.com"],
      cc: ["carol@example.com", "dave@example.com"],
      bcc: ["erin@example.com"],
      from: { email: "alice@example.com", name: "Alice" },
      subject: "Re: Hello",
      text: "plain body only",
    });
    expect(res.status).toBe(202);
    const createCall = stub.createEmail.mock.calls[0] as unknown[] | undefined;
    const draftEmail = (createCall?.[1] ?? {}) as Record<string, unknown>;
    // Arrays joined, object-from rendered as "Name <email>", text-only body stored.
    expect(draftEmail.cc).toBe("carol@example.com, dave@example.com");
    expect(draftEmail.bcc).toBe("erin@example.com");
    expect(draftEmail.sender).toBe("alice@example.com");
    expect(draftEmail.body).toBe("plain body only");
    expect(String(draftEmail.raw_headers)).toContain("Alice <alice@example.com>");
    expect(sendSpy).toHaveBeenCalled();
  });

  it("reply 202 with plain-string cc, omitted bcc, and html body", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails/e1/reply", {
      to: "bob@example.com",
      cc: "carol@example.com",
      from: "alice@example.com",
      subject: "Re: Hello",
      html: "<p>html body</p>",
    });
    expect(res.status).toBe(202);
    const createCall = stub.createEmail.mock.calls[0] as unknown[] | undefined;
    const draftEmail = (createCall?.[1] ?? {}) as Record<string, unknown>;
    // Plain-string cc passes through unchanged; omitted bcc stores null.
    expect(draftEmail.cc).toBe("carol@example.com");
    expect(draftEmail.bcc).toBeNull();
    expect(draftEmail.body).toBe("<p>html body</p>");
    const headers = JSON.parse(String(draftEmail.raw_headers)) as { key: string }[];
    expect(headers.some((h) => h.key === "cc")).toBe(true);
    expect(headers.some((h) => h.key === "bcc")).toBe(false);
  });

  it("forward 202 with object from and array cc/bcc renders header forms", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails/e1/forward", {
      to: ["carol@example.com"],
      cc: ["dave@example.com"],
      bcc: "erin@example.com",
      from: { email: "alice@example.com", name: "Alice" },
      subject: "Fwd: Hello",
      text: "look",
    });
    expect(res.status).toBe(202);
    const createCall = stub.createEmail.mock.calls[0] as unknown[] | undefined;
    const draftEmail = (createCall?.[1] ?? {}) as Record<string, unknown>;
    expect(draftEmail.cc).toBe("dave@example.com");
    expect(draftEmail.bcc).toBe("erin@example.com");
    const headers = JSON.parse(String(draftEmail.raw_headers)) as Record<string, string>[];
    expect(headers.find((h) => h.key === "from")?.value).toContain("Alice <alice@example.com>");
    expect(headers.find((h) => h.key === "to")?.value).toBe("carol@example.com");
    expect(headers.find((h) => h.key === "cc")?.value).toBe("dave@example.com");
  });

  it("forward 202 without cc/bcc stores nulls and uses string from", async () => {
    const bucket = mockBucket();
    bucket._store.set("mailboxes/alice@example.com.json", JSON.stringify({}));
    const stub = mockMailboxStub({ getEmail: vi.fn(async () => ORIGINAL) });
    const env = mockEnv(bucket, stub);
    const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails/e1/forward", {
      to: "carol@example.com",
      from: "alice@example.com",
      subject: "Fwd: Hello",
      html: "<p>look at this</p>",
    });
    expect(res.status).toBe(202);
    const createCall = stub.createEmail.mock.calls[0] as unknown[] | undefined;
    const draftEmail = (createCall?.[1] ?? {}) as Record<string, unknown>;
    expect(draftEmail.cc).toBeNull();
    expect(draftEmail.bcc).toBeNull();
    expect(draftEmail.sender).toBe("alice@example.com");
    expect(draftEmail.in_reply_to).toBeNull();
  });
});
