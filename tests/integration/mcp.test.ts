// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

// Capture tool registrations on a mock McpServer so we can invoke handlers directly.
type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
const registeredTools = new Map<string, ToolHandler>();

vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
vi.mock("agents/mcp", () => ({
  McpAgent: class {
    env: unknown;
    constructor(_state: unknown, env: unknown) {
      this.env = env;
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    constructor(_opts: unknown) {}
    tool(name: string, _desc: string, _schema: unknown, handler: ToolHandler) {
      registeredTools.set(name, handler);
    }
    registerTool(name: string, _config: unknown, handler: ToolHandler) {
      registeredTools.set(name, handler);
    }
  },
}));

// Mock the tools layer so MCP tests exercise the MCP wiring (verifyMailbox,
// error mapping, response shaping) without a real DO.
vi.mock("workers/lib/tools", () => ({
  toolListMailboxes: vi.fn(async () => [{ id: "alice@example.com", email: "alice@example.com" }]),
  toolListEmails: vi.fn(async () => [{ id: "e1", subject: "hi" }]),
  toolGetEmail: vi.fn(async (_env: unknown, _mailbox: string, emailId: string) => {
    if (emailId === "missing") return { error: "Email not found" };
    return { id: emailId, subject: "hi", body: "hello" };
  }),
  toolGetThread: vi.fn(async () => ({ thread_id: "t1", messages: [] })),
  toolSearchEmails: vi.fn(async () => [{ id: "e1" }]),
  toolDraftReply: vi.fn(async (_env: unknown, _mailbox: string, params: { body: string }) => {
    if (params.body === "bad") return { error: "Draft verification failed" };
    return { status: "draft_saved", draftId: "d1" };
  }),
  toolDraftEmail: vi.fn(async () => ({ status: "draft_saved", draftId: "d2", threadId: "t1" })),
  toolUpdateDraft: vi.fn(async (_env: unknown, _mailbox: string, params: { draftId: string }) => {
    if (params.draftId === "missing") return { error: "Draft not found" };
    return { status: "draft_updated", newDraftId: "new", oldDraftId: params.draftId };
  }),
  toolDeleteEmail: vi.fn(async (_env: unknown, _mailbox: string, emailId: string) => {
    if (emailId === "missing") return { error: "Email not found", emailId };
    return { status: "deleted", emailId };
  }),
  toolSendReply: vi.fn(async (_env: unknown, _mailbox: string, params: { originalEmailId: string }) => {
    if (params.originalEmailId === "missing") return { error: "Original email not found" };
    if (params.originalEmailId === "fail") return { error: "Failed to send reply: network" };
    return { status: "sent", messageId: "m1" };
  }),
  toolSendEmail: vi.fn(async (_env: unknown, _mailbox: string, params: { to: string }) => {
    if (params.to === "fail@ex.com") return { error: "Failed to send email: smtp down" };
    return { status: "sent", messageId: "m2" };
  }),
  toolMarkEmailRead: vi.fn(async () => ({ status: "updated" })),
  toolMoveEmail: vi.fn(async (_env: unknown, _mailbox: string, _id: string, folderId: string) => {
    if (folderId === "bad") return { error: "Failed to move email" };
    return { status: "moved" };
  }),
}));

import { EmailMCP } from "workers/mcp";

function createEnvWithBucket(mailboxes: string[] = ["alice@example.com"]) {
  const store = new Map<string, string>();
  for (const m of mailboxes) store.set(`mailboxes/${m}.json`, JSON.stringify({ fromName: m }));
  return {
    BUCKET: {
      head: vi.fn(async (key: string) => (store.has(key) ? { key } : null)),
      get: vi.fn(async (key: string) => {
        const v = store.get(key);
        return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
      }),
      put: vi.fn(async () => {}),
      list: vi.fn(async () => ({
        objects: [...mailboxes.map((m) => ({ key: `mailboxes/${m}.json` }))],
        truncated: false,
      })),
      delete: vi.fn(async () => {}),
    } as unknown as R2Bucket,
    MAILBOX: {
      idFromName: vi.fn((n: string) => n as unknown as DurableObjectId),
      get: vi.fn(() => ({}) as unknown as DurableObjectStub<unknown>),
    } as unknown as DurableObjectNamespace,
    EMAIL: { send: vi.fn() } as unknown as SendEmail,
    AI: { run: vi.fn() } as unknown as Ai,
  } as unknown as Cloudflare.Env;
}

async function initMcp(mailboxes?: string[]) {
  const env = createEnvWithBucket(mailboxes);
  const mcp = new EmailMCP({} as unknown as DurableObjectState, env);
  await mcp.init();
  return { mcp, env };
}

function callTool(name: string, args: Record<string, unknown>) {
  const handler = registeredTools.get(name);
  if (!handler) throw new Error(`tool not registered: ${name}`);
  return handler(args);
}

describe("EmailMCP tool registration", () => {
  beforeEach(() => {
    registeredTools.clear();
  });

  it("registers all 13 email tools", async () => {
    await initMcp();
    const expected = [
      "list_mailboxes",
      "list_emails",
      "get_email",
      "get_thread",
      "search_emails",
      "draft_reply",
      "create_draft",
      "update_draft",
      "delete_email",
      "send_reply",
      "send_email",
      "mark_email_read",
      "move_email",
    ];
    for (const name of expected) {
      expect(registeredTools.has(name)).toBe(true);
    }
  });
});

describe("EmailMCP verifyMailbox gate", () => {
  beforeEach(() => {
    registeredTools.clear();
  });

  it("rejects unknown mailbox with helpful error", async () => {
    await initMcp(["alice@example.com"]);
    const res = (await callTool("list_emails", {
      mailboxId: "ghost@example.com",
      folder: "inbox",
      limit: 20,
      page: 1,
    })) as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("not found");
    expect(res.content[0].text).toContain("list_mailboxes");
  });

  it("allows known mailbox", async () => {
    await initMcp(["alice@example.com"]);
    const res = (await callTool("list_emails", {
      mailboxId: "alice@example.com",
      folder: "inbox",
      limit: 20,
      page: 1,
    })) as { content: { text: string }[]; isError?: boolean };
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toEqual([{ id: "e1", subject: "hi" }]);
  });
});

describe("EmailMCP tool handlers", () => {
  beforeEach(() => {
    registeredTools.clear();
  });

  it("list_mailboxes returns mailboxes", async () => {
    await initMcp();
    const res = (await callTool("list_mailboxes", {})) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0].text)).toEqual([
      { id: "alice@example.com", email: "alice@example.com" },
    ]);
  });

  it("get_email returns isError for missing email", async () => {
    await initMcp();
    const res = (await callTool("get_email", {
      mailboxId: "alice@example.com",
      emailId: "missing",
    })) as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Email not found");
  });

  it("get_email returns email payload for existing", async () => {
    await initMcp();
    const res = (await callTool("get_email", {
      mailboxId: "alice@example.com",
      emailId: "e1",
    })) as { content: { text: string }[]; isError?: boolean };
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "e1" });
  });

  it("get_thread returns thread", async () => {
    await initMcp();
    const res = (await callTool("get_thread", {
      mailboxId: "alice@example.com",
      threadId: "t1",
    })) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0].text)).toMatchObject({ thread_id: "t1" });
  });

  it("search_emails returns results", async () => {
    await initMcp();
    const res = (await callTool("search_emails", {
      mailboxId: "alice@example.com",
      query: "pricing",
    })) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0].text)).toEqual([{ id: "e1" }]);
  });

  it("draft_reply wraps error with isError", async () => {
    await initMcp();
    const res = (await callTool("draft_reply", {
      mailboxId: "alice@example.com",
      originalEmailId: "e1",
      to: "bob@ex.com",
      subject: "Re: hi",
      bodyHtml: "bad",
    })) as { isError: boolean };
    expect(res.isError).toBe(true);
  });

  it("create_draft maps to draft_created shape", async () => {
    await initMcp();
    const res = (await callTool("create_draft", {
      mailboxId: "alice@example.com",
      subject: "Hi",
      bodyHtml: "<p>Hi</p>",
    })) as { content: { text: string }[] };
    const payload = JSON.parse(res.content[0].text);
    expect(payload.status).toBe("draft_created");
    expect(payload.draftId).toBe("d2");
    expect(payload.threadId).toBe("t1");
  });

  it("update_draft returns isError for missing draft", async () => {
    await initMcp();
    const res = (await callTool("update_draft", {
      mailboxId: "alice@example.com",
      draftId: "missing",
    })) as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Draft not found");
  });

  it("delete_email wraps error with isError", async () => {
    await initMcp();
    const res = (await callTool("delete_email", {
      mailboxId: "alice@example.com",
      emailId: "missing",
    })) as { isError: boolean };
    expect(res.isError).toBe(true);
  });

  it("send_reply returns isError for missing original", async () => {
    await initMcp();
    const res = (await callTool("send_reply", {
      mailboxId: "alice@example.com",
      originalEmailId: "missing",
      to: "bob@ex.com",
      subject: "Re: hi",
      bodyHtml: "<p>hi</p>",
    })) as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Original email not found");
  });

  it("send_reply returns isError for send failure", async () => {
    await initMcp();
    const res = (await callTool("send_reply", {
      mailboxId: "alice@example.com",
      originalEmailId: "fail",
      to: "bob@ex.com",
      subject: "Re: hi",
      bodyHtml: "<p>hi</p>",
    })) as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Failed to send reply: network");
  });

  it("send_reply succeeds", async () => {
    await initMcp();
    const res = (await callTool("send_reply", {
      mailboxId: "alice@example.com",
      originalEmailId: "e1",
      to: "bob@ex.com",
      subject: "Re: hi",
      bodyHtml: "<p>hi</p>",
    })) as { content: { text: string }[]; isError?: boolean };
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ status: "sent" });
  });

  it("send_email returns isError for send failure", async () => {
    await initMcp();
    const res = (await callTool("send_email", {
      mailboxId: "alice@example.com",
      to: "fail@ex.com",
      subject: "Hi",
      bodyHtml: "<p>hi</p>",
    })) as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe("Failed to send email: smtp down");
  });

  it("mark_email_read returns updated", async () => {
    await initMcp();
    const res = (await callTool("mark_email_read", {
      mailboxId: "alice@example.com",
      emailId: "e1",
      read: true,
    })) as { content: { text: string }[] };
    expect(JSON.parse(res.content[0].text)).toEqual({ status: "updated" });
  });

  it("move_email returns isError for bad folder", async () => {
    await initMcp();
    const res = (await callTool("move_email", {
      mailboxId: "alice@example.com",
      emailId: "e1",
      folderId: "bad",
    })) as { content: { text: string }[]; isError: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Failed to move email");
  });

  it("move_email succeeds for good folder", async () => {
    await initMcp();
    const res = (await callTool("move_email", {
      mailboxId: "alice@example.com",
      emailId: "e1",
      folderId: "archive",
    })) as { content: { text: string }[]; isError?: boolean };
    expect(res.isError).toBeUndefined();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ status: "moved" });
  });
});
