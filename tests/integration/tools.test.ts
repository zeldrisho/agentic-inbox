// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

// Mock AI (verifyDraft) and email-sender so tool tests exercise real business logic.
vi.mock("workers/lib/ai", () => ({
  verifyDraft: vi.fn(async (_ai: unknown, body: string) => body),
  isPromptInjection: vi.fn(async () => false),
}));
vi.mock("workers/email-sender", () => ({
  sendEmail: vi.fn(async () => ({ messageId: "sent-1" })),
}));

import {
  toolListMailboxes,
  toolListEmails,
  toolGetEmail,
  toolGetThread,
  toolSearchEmails,
  toolDraftReply,
  toolDraftEmail,
  toolUpdateDraft,
  toolMarkEmailRead,
  toolMoveEmail,
  toolDiscardDraft,
  toolDeleteEmail,
  toolSendReply,
  toolSendEmail,
} from "workers/lib/tools";
import { verifyDraft } from "workers/lib/ai";
import { sendEmail } from "workers/email-sender";
import { Folders } from "shared/folders";
import type { Env } from "workers/types";

// ── Mock helpers ────────────────────────────────────────────────────

function createMockBucket(initial: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  for (const [k, v] of Object.entries(initial)) store.set(k, JSON.stringify(v));
  return {
    head: vi.fn(async (key: string) => (store.has(key) ? { key } : null)),
    get: vi.fn(async (key: string) => {
      const v = store.get(key);
      return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
    }),
    put: vi.fn(async (key: string, value: string | Uint8Array) => {
      store.set(
        key,
        typeof value === "string" ? value : new TextDecoder().decode(value as Uint8Array),
      );
    }),
    list: vi.fn(async () => ({
      objects: [...store.keys()]
        .filter((k) => k.startsWith("mailboxes/"))
        .map((k) => ({ key: k })),
      truncated: false,
    })),
    delete: vi.fn(async () => {}),
    _store: store,
  };
}

function createMailboxStub(overrides: Record<string, unknown> = {}) {
  return {
    getEmail: vi.fn(async () => null),
    getEmails: vi.fn(async () => []),
    getThreadEmails: vi.fn(async () => []),
    createEmail: vi.fn(async () => {}),
    replaceDraft: vi.fn(async () => true),
    updateDeliveryStatus: vi.fn(async () => {}),
    deleteEmail: vi.fn(async () => []),
    moveEmail: vi.fn(async () => true),
    updateEmail: vi.fn(async () => null),
    checkSendRateLimit: vi.fn(async () => null),
    searchEmails: vi.fn(async () => []),
    ...overrides,
  };
}

function createMockEnv(overrides: Record<string, unknown> = {}) {
  const stub = createMailboxStub(overrides.stub as Record<string, unknown>);
  const bucket = createMockBucket(
    (overrides.bucket as Record<string, unknown> | undefined) ?? {},
  );
  const env = {
    BUCKET: bucket,
    MAILBOX: {
      idFromName: vi.fn((n: string) => n as unknown as DurableObjectId),
      get: vi.fn(() => stub),
    },
    AI: { run: vi.fn() } as unknown as Ai,
    EMAIL: { send: vi.fn() } as unknown as SendEmail,
    _stub: stub,
  } as unknown as Env & { _stub: ReturnType<typeof createMailboxStub> };
  return env;
}

const ORIGINAL_EMAIL = {
  id: "e1",
  subject: "Hello",
  sender: "bob@ex.com",
  recipient: "alice@ex.com",
  date: "2026-01-01T00:00:00.000Z",
  read: true,
  starred: false,
  body: "<p>Original body</p>",
  thread_id: "t1",
  message_id: "msg-1",
  email_references: JSON.stringify(["msg-0"]),
};

// ── toolListMailboxes / toolListEmails ──────────────────────────────


/** Asserts a tool result is the success branch, throwing on the `{ error }` shape. */
function expectOk<T>(result: T): Extract<T, { status: string }> {
  if (result !== null && typeof result === "object" && "error" in result) {
    throw new Error(`Unexpected tool error: ${String((result as { error: unknown }).error)}`);
  }
  return result as Extract<T, { status: string }>;
}

describe("toolListMailboxes", () => {
  it("lists mailboxes from bucket metadata", async () => {
    const env = createMockEnv({
      bucket: {
        "mailboxes/alice@example.com.json": { fromName: "Alice" },
        "mailboxes/bob@example.com.json": { fromName: "Bob" },
      },
    });
    const result = await toolListMailboxes(env);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id).sort()).toEqual([
      "alice@example.com",
      "bob@example.com",
    ]);
  });

  it("returns empty when no mailboxes", async () => {
    const env = createMockEnv();
    expect(await toolListMailboxes(env)).toEqual([]);
  });
});

describe("toolListEmails", () => {
  it("calls stub.getEmails with pagination and date sort", async () => {
    const stub = createMailboxStub({
      getEmails: vi.fn(async () => [{ id: "e1", subject: "hi" }]),
    });
    const env = createMockEnv({ stub });
    const result = await toolListEmails(env, "alice@example.com", {
      folder: "inbox",
      limit: 10,
      page: 2,
    });
    expect(result).toEqual([{ id: "e1", subject: "hi" }]);
    expect(stub.getEmails).toHaveBeenCalledWith({
      folder: "inbox",
      limit: 10,
      page: 2,
      sortColumn: "date",
      sortDirection: "DESC",
    });
  });
});

// ── toolGetEmail / toolGetThread ───────────────────────────────────

describe("toolGetEmail", () => {
  it("returns error when email not found", async () => {
    const env = createMockEnv({ stub: { getEmail: vi.fn(async () => null) } });
    expect(await toolGetEmail(env, "alice@example.com", "missing")).toEqual({
      error: "Email not found",
    });
  });

  it("returns email with body_text and body_html", async () => {
    const env = createMockEnv({ stub: { getEmail: vi.fn(async () => ORIGINAL_EMAIL) } });
    const result = await toolGetEmail(env, "alice@example.com", "e1");
    expect(result).toMatchObject({
      id: "e1",
      body_text: "Original body",
      body_html: "<p>Original body</p>",
    });
  });
});

describe("toolGetThread", () => {
  it("returns thread with chronologically sorted messages", async () => {
    const stub = createMailboxStub({
      getThreadEmails: vi.fn(async () => [
        { ...ORIGINAL_EMAIL, id: "e2", date: "2026-01-02T00:00:00.000Z" },
        { ...ORIGINAL_EMAIL, id: "e1", date: "2026-01-01T00:00:00.000Z" },
      ]),
    });
    const env = createMockEnv({ stub });
    const result = await toolGetThread(env, "alice@example.com", "t1");
    expect(result.thread_id).toBe("t1");
    expect(result.message_count).toBe(2);
    expect(result.messages[0].id).toBe("e1");
    expect(result.messages[1].id).toBe("e2");
  });
});

// ── toolSearchEmails ────────────────────────────────────────────────

describe("toolSearchEmails", () => {
  it("delegates to stub.searchEmails with query and folder", async () => {
    const stub = createMailboxStub({
      searchEmails: vi.fn(async () => [{ id: "e1" }]),
    });
    const env = createMockEnv({ stub });
    const result = await toolSearchEmails(env, "alice@example.com", {
      query: "pricing",
      folder: "inbox",
    });
    expect(result).toEqual([{ id: "e1" }]);
    expect(stub.searchEmails).toHaveBeenCalledWith({ query: "pricing", folder: "inbox" });
  });
});

// ── toolDraftReply ─────────────────────────────────────────────────

describe("toolDraftReply", () => {
  beforeEach(() => {
    vi.mocked(verifyDraft).mockClear();
  });

  it("saves a verified draft reply with quoted block and threading", async () => {
    const stub = createMailboxStub({ getEmail: vi.fn(async () => ORIGINAL_EMAIL) });
    const env = createMockEnv({ stub });
    const result = await toolDraftReply(env, "alice@example.com", {
      originalEmailId: "e1",
      to: "bob@example.com",
      subject: "Re: Hello",
      body: "Thanks for the note",
      isPlainText: true,
      runVerifyDraft: true,
    });
    const ok1 = expectOk(result);
    expect(ok1.status).toBe("draft_saved");
    expect(verifyDraft).toHaveBeenCalled();
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[0]).toBe(Folders.DRAFT);
    expect(created[1]).toMatchObject({
      in_reply_to: "e1",
      thread_id: "t1",
      recipient: "bob@example.com",
    });
    expect(created[1].body).toContain("<blockquote");
  });

  it("returns error when verification returns empty", async () => {
    vi.mocked(verifyDraft).mockResolvedValueOnce("");
    const env = createMockEnv();
    const result = await toolDraftReply(env, "alice@example.com", {
      originalEmailId: "e1",
      to: "bob@example.com",
      subject: "Re: Hello",
      body: "Thanks",
      runVerifyDraft: true,
    });
    expect(result).toEqual({
      error: "Draft verification failed — body could not be verified. Please try again.",
    });
  });

  it("uses original email id as thread when no thread_id", async () => {
    const stub = createMailboxStub({
      getEmail: vi.fn(async () => ({ ...ORIGINAL_EMAIL, thread_id: null })),
    });
    const env = createMockEnv({ stub });
    const result = await toolDraftReply(env, "alice@example.com", {
      originalEmailId: "e1",
      to: "bob@example.com",
      subject: "Re: Hello",
      body: "Thanks",
    });
    expect(expectOk(result).status).toBe("draft_saved");
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[1].thread_id).toBe("e1");
  });
});

// ── toolDraftEmail ─────────────────────────────────────────────────

describe("toolDraftEmail", () => {
  it("creates a new draft with its own thread id", async () => {
    const stub = createMailboxStub();
    const env = createMockEnv({ stub });
    const result = await toolDraftEmail(env, "alice@example.com", {
      to: "bob@example.com",
      subject: "Hi",
      body: "Hello there",
      isPlainText: true,
    });
    const okDraft = expectOk(result);
    expect(okDraft.status).toBe("draft_saved");
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[0]).toBe(Folders.DRAFT);
    expect(created[1].thread_id).toBe(okDraft.draftId);
    expect(created[1].body).toContain("Hello there");
  });

  it("resolves thread from in_reply_to original", async () => {
    const stub = createMailboxStub({ getEmail: vi.fn(async () => ORIGINAL_EMAIL) });
    const env = createMockEnv({ stub });
    const result = await toolDraftEmail(env, "alice@example.com", {
      to: "bob@example.com",
      subject: "Hi",
      body: "Hello",
      in_reply_to: "e1",
    });
    expect(expectOk(result).threadId).toBe("t1");
  });

  it("returns error when verification fails", async () => {
    vi.mocked(verifyDraft).mockResolvedValueOnce("");
    const env = createMockEnv();
    const result = await toolDraftEmail(env, "alice@example.com", {
      to: "bob@example.com",
      subject: "Hi",
      body: "Hello",
      runVerifyDraft: true,
    });
    expect(result).toEqual({
      error: "Draft verification failed — body could not be verified. Please try again.",
    });
  });
});

// ── toolUpdateDraft ────────────────────────────────────────────────

describe("toolUpdateDraft", () => {
  it("returns error when draft missing", async () => {
    const env = createMockEnv({ stub: { getEmail: vi.fn(async () => null) } });
    expect(await toolUpdateDraft(env, "alice@example.com", { draftId: "missing" })).toEqual({
      error: "Draft not found",
    });
  });

  it("verifies and atomically replaces the draft preserving threading", async () => {
    const stub = createMailboxStub({
      getEmail: vi.fn(async () => ({
        ...ORIGINAL_EMAIL,
        folder_id: Folders.DRAFT,
        body: "old body",
      })),
    });
    const env = createMockEnv({ stub });
    const result = await toolUpdateDraft(env, "alice@example.com", {
      draftId: "d1",
      subject: "Updated",
      bodyHtml: "New body content here",
    });
    expect(expectOk(result).status).toBe("draft_updated");
    expect(stub.replaceDraft).toHaveBeenCalledWith("draft", "d1", expect.objectContaining({ subject: "Updated", thread_id: "t1" }));
  });

  it("keeps old draft when verification fails", async () => {
    vi.mocked(verifyDraft).mockResolvedValueOnce("");
    const stub = createMailboxStub({
      getEmail: vi.fn(async () => ({ ...ORIGINAL_EMAIL, folder_id: Folders.DRAFT })),
    });
    const env = createMockEnv({ stub });
    const result = await toolUpdateDraft(env, "alice@example.com", {
      draftId: "d1",
      bodyHtml: "New body",
    });
    expect(result).toEqual({
      error: "Draft verification failed — keeping existing draft unchanged. Please try again.",
    });
    expect(stub.deleteEmail).not.toHaveBeenCalled();
  });
});

// ── toolMarkEmailRead / toolMoveEmail ──────────────────────────────

describe("toolMarkEmailRead", () => {
  it("updates read status", async () => {
    const stub = createMailboxStub();
    const env = createMockEnv({ stub });
    const result = await toolMarkEmailRead(env, "alice@example.com", "e1", true);
    expect(result).toEqual({ status: "updated", emailId: "e1", read: true });
    expect(stub.updateEmail).toHaveBeenCalledWith("e1", { read: true });
  });
});

describe("toolMoveEmail", () => {
  it("returns moved status on success", async () => {
    const stub = createMailboxStub({ moveEmail: vi.fn(async () => true) });
    const env = createMockEnv({ stub });
    expect(await toolMoveEmail(env, "alice@example.com", "e1", "archive")).toEqual({
      status: "moved",
      emailId: "e1",
      folder: "archive",
    });
  });

  it("returns error when folder not found", async () => {
    const stub = createMailboxStub({ moveEmail: vi.fn(async () => false) });
    const env = createMockEnv({ stub });
    expect(await toolMoveEmail(env, "alice@example.com", "e1", "bad")).toEqual({
      error: "Failed to move email",
    });
  });
});

// ── toolDiscardDraft / toolDeleteEmail ─────────────────────────────

describe("toolDiscardDraft", () => {
  it("returns error when draft missing", async () => {
    const env = createMockEnv({ stub: { getEmail: vi.fn(async () => null) } });
    expect(await toolDiscardDraft(env, "alice@example.com", "d1")).toEqual({
      error: "Draft not found",
    });
  });

  it("refuses to discard non-draft emails", async () => {
    const env = createMockEnv({
      stub: { getEmail: vi.fn(async () => ({ ...ORIGINAL_EMAIL, folder_id: "inbox" })) },
    });
    expect(await toolDiscardDraft(env, "alice@example.com", "e1")).toEqual({
      error: "Cannot discard: email is not a draft",
    });
  });

  it("discards a draft", async () => {
    const stub = createMailboxStub({
      getEmail: vi.fn(async () => ({ ...ORIGINAL_EMAIL, folder_id: Folders.DRAFT })),
    });
    const env = createMockEnv({ stub });
    expect(await toolDiscardDraft(env, "alice@example.com", "d1")).toEqual({
      status: "discarded",
      draftId: "d1",
    });
    expect(stub.deleteEmail).toHaveBeenCalledWith("d1");
  });
});

describe("toolDeleteEmail", () => {
  it("returns error when email not found", async () => {
    const stub = createMailboxStub({ deleteEmail: vi.fn(async () => null) });
    const env = createMockEnv({ stub });
    expect(await toolDeleteEmail(env, "alice@example.com", "e1")).toEqual({
      error: "Email not found",
      emailId: "e1",
    });
  });

  it("deletes email and returns status", async () => {
    const stub = createMailboxStub({
      deleteEmail: vi.fn(async () => [{ id: "att1", filename: "f.txt" }]),
    });
    const env = createMockEnv({ stub });
    expect(await toolDeleteEmail(env, "alice@example.com", "e1")).toEqual({
      status: "deleted",
      emailId: "e1",
    });
  });
});

// ── toolSendReply ─────────────────────────────────────────────────

describe("toolSendReply", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockClear();
    vi.mocked(verifyDraft).mockClear();
  });

  it("returns rate-limit error when exceeded", async () => {
    const stub = createMailboxStub({
      checkSendRateLimit: vi.fn(async () => "Rate limit exceeded: max 20 emails per hour"),
    });
    const env = createMockEnv({ stub });
    const result = await toolSendReply(env, "alice@example.com", {
      originalEmailId: "e1",
      to: "bob@example.com",
      subject: "Re: Hello",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result).toEqual({ error: "Rate limit exceeded: max 20 emails per hour" });
  });

  it("returns error when original email missing", async () => {
    const env = createMockEnv({ stub: { getEmail: vi.fn(async () => null) } });
    const result = await toolSendReply(env, "alice@example.com", {
      originalEmailId: "missing",
      to: "bob@example.com",
      subject: "Re: Hello",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result).toEqual({ error: "Original email not found" });
  });

  it("returns error when verification fails", async () => {
    vi.mocked(verifyDraft).mockResolvedValueOnce("");
    const env = createMockEnv({ stub: { getEmail: vi.fn(async () => ORIGINAL_EMAIL) } });
    const result = await toolSendReply(env, "alice@example.com", {
      originalEmailId: "e1",
      to: "bob@example.com",
      subject: "Re: Hello",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result).toEqual({
      error: "Draft verification failed — refusing to send unverified content. Please try again.",
    });
  });

  it("returns error when sendEmail throws", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("network down"));
    const env = createMockEnv({ stub: { getEmail: vi.fn(async () => ORIGINAL_EMAIL) } });
    const result = await toolSendReply(env, "alice@example.com", {
      originalEmailId: "e1",
      to: "bob@example.com",
      subject: "Re: Hello",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result).toEqual({ error: "Failed to send reply: network down" });
  });

  it("sends reply with threading headers and records in Sent", async () => {
    const stub = createMailboxStub({ getEmail: vi.fn(async () => ORIGINAL_EMAIL) });
    const env = createMockEnv({ stub });
    const result = await toolSendReply(env, "alice@example.com", {
      originalEmailId: "e1",
      to: "bob@example.com",
      subject: "Re: Hello",
      bodyHtml: "<p>Hi there</p>",
    });
    expect(expectOk(result).status).toBe("sent");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: "bob@example.com",
        from: "alice@example.com",
        headers: { "In-Reply-To": "<msg-1>", References: "<msg-0> <msg-1>" },
      }),
    );
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[0]).toBe(Folders.SENT);
    expect(created[1].thread_id).toBe("t1");
  });
});

// ── toolSendEmail ──────────────────────────────────────────────────

describe("toolSendEmail", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockClear();
    vi.mocked(verifyDraft).mockClear();
  });

  it("returns rate-limit error when exceeded", async () => {
    const stub = createMailboxStub({
      checkSendRateLimit: vi.fn(async () => "Rate limit exceeded: max 100 emails per day"),
    });
    const env = createMockEnv({ stub });
    const result = await toolSendEmail(env, "alice@example.com", {
      to: "bob@example.com",
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result).toEqual({ error: "Rate limit exceeded: max 100 emails per day" });
  });

  it("returns error when verification fails", async () => {
    vi.mocked(verifyDraft).mockResolvedValueOnce("");
    const env = createMockEnv();
    const result = await toolSendEmail(env, "alice@example.com", {
      to: "bob@example.com",
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result).toEqual({
      error: "Draft verification failed — refusing to send unverified content. Please try again.",
    });
  });

  it("returns error when sendEmail throws", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("smtp down"));
    const env = createMockEnv();
    const result = await toolSendEmail(env, "alice@example.com", {
      to: "bob@example.com",
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
    });
    expect(result).toEqual({ error: "Failed to send email: smtp down" });
  });

  it("sends email and records in Sent", async () => {
    const stub = createMailboxStub();
    const env = createMockEnv({ stub });
    const result = await toolSendEmail(env, "alice@example.com", {
      to: "bob@example.com",
      subject: "Hi",
      bodyHtml: "<p>Hello</p>",
    });
    expect(expectOk(result).status).toBe("sent");
    expect(sendEmail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: "bob@example.com", from: "alice@example.com" }),
    );
    const created = (stub.createEmail as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(created[0]).toBe(Folders.SENT);
    expect(created[1].thread_id).toBe(created[1].id);
  });
});
