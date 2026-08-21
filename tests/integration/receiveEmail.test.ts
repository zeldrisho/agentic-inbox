// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { receiveEmail } from "workers/index";

// Helpers to build raw email bytes
function buildRawEmail(headers: string, body: string): Uint8Array {
  const raw = `${headers}\r\n\r\n${body}`;
  return new TextEncoder().encode(raw);
}

function makeStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function createMockBucket(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(initial)) store.set(k, JSON.stringify(v));
  return {
    head: vi.fn(async (key: string) => (store.has(key) ? { key } : null)),
    get: vi.fn(async (key: string) => {
      const val = store.get(key);
      if (val === undefined) return null;
      return { json: async () => JSON.parse(val) } as unknown as R2ObjectBody;
    }),
    put: vi.fn(async (key: string, value: string | Uint8Array) => {
      store.set(key, typeof value === "string" ? value : new TextDecoder().decode(value as Uint8Array));
    }),
    list: vi.fn(async () => ({ objects: [...store.keys()].filter((k) => k.startsWith("mailboxes/")).map((k) => ({ key: k })), truncated: false })),
    delete: vi.fn(async () => {}),
    _store: store,
  };
}

function createMockMailboxStore() {
  const emails: unknown[] = [];
  const stub = {
    createEmail: vi.fn(async (...args: unknown[]) => { emails.push(args); }),
    findThreadBySubject: vi.fn(async () => null),
    getFolders: vi.fn(async () => []),
    getEmails: vi.fn(async () => []),
    getEmail: vi.fn(async () => null),
  };
  const ns = {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => stub),
  };
  return { ns, stub, emails };
}

describe("receiveEmail size cap", () => {
  it("throws when rawSize exceeds 25MB", async () => {
    const env = {
      BUCKET: createMockBucket(),
      MAILBOX: createMockMailboxStore().ns,
      EMAIL_AGENT: { idFromName: vi.fn(() => "id"), get: vi.fn(() => ({ fetch: vi.fn(async () => new Response("ok")) })) },
      EMAIL_ADDRESSES: [],
    } as unknown as Env;
    const bytes = new Uint8Array(10);
    const stream = makeStream(bytes);
    await expect(receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: 26 * 1024 * 1024 }, env as unknown as Env, { waitUntil: vi.fn() } as unknown as ExecutionContext)).rejects.toThrow(/too large/i);
  });

  it("throws on invalid stream size", async () => {
    const env = {
      BUCKET: createMockBucket(),
      MAILBOX: createMockMailboxStore().ns,
      EMAIL_ADDRESSES: [],
    } as unknown as Env;
    const bytes = new Uint8Array(10);
    const stream = makeStream(bytes);
    await expect(receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: 0 }, env as unknown as Env, { waitUntil: vi.fn() } as unknown as ExecutionContext)).rejects.toThrow(/Invalid stream size/i);
  });

  it("throws when stream exceeds declared size", async () => {
    // Build a stream that reports smaller size than actual bytes
    const bytes = new Uint8Array(20);
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(bytes); c.close(); },
    });
    const env = {
      BUCKET: createMockBucket(),
      MAILBOX: createMockMailboxStore().ns,
      EMAIL_ADDRESSES: [],
    } as unknown as Env;
    await expect(receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: 10 }, env as unknown as Env, { waitUntil: vi.fn() } as unknown as ExecutionContext)).rejects.toThrow(/exceeds declared size/i);
  });
});

describe("receiveEmail allowlist", () => {
  it("ignores email when no recipient matches allowlist", async () => {
    const bucket = createMockBucket({ "mailboxes/allowed@example.com.json": { fromName: "Allowed" } });
    const { ns, stub } = createMockMailboxStore();
    const env = {
      BUCKET: bucket,
      MAILBOX: ns,
      EMAIL_ADDRESSES: ["allowed@example.com"],
      EMAIL_AGENT: { idFromName: vi.fn(() => "id"), get: vi.fn(() => ({ fetch: vi.fn() })) },
    } as unknown as Env;
    const raw = buildRawEmail("From: sender@ex.com\r\nTo: other@example.com\r\nSubject: hi\r\nMessage-ID: <m1@ex.com>", "hello");
    const stream = makeStream(raw);
    await receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: raw.length }, env as unknown as Env, { waitUntil: vi.fn() } as unknown as ExecutionContext);
    expect(stub.createEmail).not.toHaveBeenCalled();
  });

  it("stores email when recipient matches allowlist", async () => {
    const bucket = createMockBucket({ "mailboxes/allowed@example.com.json": { fromName: "Allowed" } });
    const { ns, stub } = createMockMailboxStore();
    const env = {
      BUCKET: bucket,
      MAILBOX: ns,
      EMAIL_ADDRESSES: ["allowed@example.com"],
      EMAIL_AGENT: { idFromName: vi.fn(() => "id"), get: vi.fn(() => ({ fetch: vi.fn(async () => new Response("ok")) })) },
    } as unknown as Env;
    // also need mailbox existence for effective mailbox check: bucket head for allowed mailbox returns truthy
    const raw = buildRawEmail("From: sender@ex.com\r\nTo: allowed@example.com\r\nSubject: hi", "hello");
    const stream = makeStream(raw);
    await receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: raw.length }, env as unknown as Env, { waitUntil: vi.fn(async (p: Promise<unknown>) => { await p; }) } as unknown as ExecutionContext);
    expect(stub.createEmail).toHaveBeenCalled();
  });

  it("throws when email has no To header", async () => {
    const bucket = createMockBucket();
    const { ns } = createMockMailboxStore();
    const env = { BUCKET: bucket, MAILBOX: ns, EMAIL_ADDRESSES: [] } as unknown as Env;
    const raw = buildRawEmail("From: sender@ex.com\r\nSubject: hi", "hello");
    const stream = makeStream(raw);
    await expect(receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: raw.length }, env as unknown as Env, { waitUntil: vi.fn() } as unknown as ExecutionContext)).rejects.toThrow(/empty to/i);
  });
});

describe("receiveEmail admin mirror + agentAutoDraft matrix", () => {
  function setupMirror(extraMailboxes: Record<string, unknown> = {}) {
    const bucket = createMockBucket({
      "mailboxes/admin@example.com.json": { fromName: "Admin" },
      ...extraMailboxes,
    });
    const adminStore = createMockMailboxStore();
    const primaryStore = createMockMailboxStore();
    // MAILBOX.get returns different stub based on name
    const ns = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn((id: string) => {
        if (id === "admin@example.com") return adminStore.stub;
        if (id === "unknown@example.com") return primaryStore.stub; // will be catch-all routed
        // For effectiveMailboxId routing, unknown -> admin
        // When mailbox doesn't exist, receiveEmail resolves admin mailbox; we need to mock BUCKET.head correctly
        return adminStore.stub;
      }),
    };
    return { bucket, ns, adminStore, primaryStore };
  }

  it("catch-all routes unknown recipient to admin and mirrors once", async () => {
    const { bucket, ns, adminStore } = setupMirror();
    // unknown@example.com does NOT exist, so head returns null; admin exists
    // Need bucket.head to reflect that
    const headSpy = bucket.head as unknown as ReturnType<typeof vi.fn>;
    // Already default impl checks store: unknown not in store, admin is
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" })));
    const agentNs = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: fetchMock })),
    };
    const env = {
      BUCKET: bucket,
      MAILBOX: ns,
      EMAIL_AGENT: agentNs,
      EMAIL_ADDRESSES: [],
    } as unknown as Env;
    // Enable auto-draft for admin
    bucket._store.set("mailboxes/admin@example.com.json", JSON.stringify({ agentAutoDraft: true }));

    const raw = buildRawEmail("From: sender@ex.com\r\nTo: unknown@example.com\r\nSubject: test", "body");
    const stream = makeStream(raw);
    const waitUntil = vi.fn((p: Promise<unknown>) => p.catch(() => {}));
    await receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: raw.length }, env as unknown as Env, { waitUntil: waitUntil as unknown as (p: Promise<unknown>) => void } as unknown as ExecutionContext);
    // admin stub should have been called at least once for primary delivery (effectiveMailboxId is admin)
    expect(adminStore.stub.createEmail).toHaveBeenCalled();
  });

  it("does not trigger agent when agentAutoDraft is false", async () => {
    const bucket = createMockBucket({ "mailboxes/user@example.com.json": { agentAutoDraft: false } });
    const { ns, stub } = createMockMailboxStore();
    const fetchMock = vi.fn(async () => new Response("ok"));
    const env = {
      BUCKET: bucket,
      MAILBOX: ns,
      EMAIL_AGENT: { idFromName: vi.fn((n: string) => n), get: vi.fn(() => ({ fetch: fetchMock })) },
      EMAIL_ADDRESSES: [],
    } as unknown as Env;
    const raw = buildRawEmail("From: sender@ex.com\r\nTo: user@example.com\r\nSubject: hi", "hello");
    const stream = makeStream(raw);
    const waitUntil = vi.fn();
    await receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: raw.length }, env as unknown as Env, { waitUntil: waitUntil as unknown as (p: Promise<unknown>) => void } as unknown as ExecutionContext);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("triggers agent when agentAutoDraft is true", async () => {
    const bucket = createMockBucket({ "mailboxes/user@example.com.json": { agentAutoDraft: true } });
    const { ns } = createMockMailboxStore();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "draft_generated" })));
    const env = {
      BUCKET: bucket,
      MAILBOX: ns,
      EMAIL_AGENT: { idFromName: vi.fn((n: string) => n), get: vi.fn(() => ({ fetch: fetchMock })) },
      EMAIL_ADDRESSES: [],
    } as unknown as Env;
    const raw = buildRawEmail("From: sender@ex.com\r\nTo: user@example.com\r\nSubject: hi", "hello");
    const stream = makeStream(raw);
    const waitUntilCalls: Promise<unknown>[] = [];
    const waitUntil = vi.fn((p: Promise<unknown>) => { waitUntilCalls.push(p); });
    await receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: raw.length }, env as unknown as Env, { waitUntil: waitUntil as unknown as (p: Promise<unknown>) => void } as unknown as ExecutionContext);
    // waitUntil should have been called at least once and fetch invoked
    expect(waitUntil).toHaveBeenCalled();
    // Allow microtasks to flush
    await Promise.allSettled(waitUntilCalls);
    expect(fetchMock).toHaveBeenCalled();
    const req = fetchMock.mock.calls[0]?.[0] as Request;
    expect(req.url).toContain("/onNewEmail");
  });

  it("ignores when no catch-all found for unknown domain", async () => {
    const bucket = createMockBucket(); // no admin mailbox
    const { ns, stub } = createMockMailboxStore();
    const env = {
      BUCKET: bucket,
      MAILBOX: ns,
      EMAIL_ADDRESSES: [],
      EMAIL_AGENT: { idFromName: vi.fn((n: string) => n), get: vi.fn(() => ({ fetch: vi.fn() })) },
    } as unknown as Env;
    const raw = buildRawEmail("From: sender@ex.com\r\nTo: ghost@unknown-domain.com\r\nSubject: hi", "body");
    const stream = makeStream(raw);
    await receiveEmail({ raw: stream as unknown as ReadableStream, rawSize: raw.length }, env as unknown as Env, { waitUntil: vi.fn() } as unknown as ExecutionContext);
    expect(stub.createEmail).not.toHaveBeenCalled();
  });
});

type Env = {
  BUCKET: ReturnType<typeof createMockBucket>;
  MAILBOX: ReturnType<typeof createMockMailboxStore>["ns"];
  EMAIL_AGENT: { idFromName: (n: string) => string; get: (id: string) => { fetch: ReturnType<typeof vi.fn> } };
  EMAIL_ADDRESSES: string[];
};
