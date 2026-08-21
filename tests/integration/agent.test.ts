// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

// ── Mocks for the agent's heavy dependencies ────────────────────────
// vi.mock factories are hoisted, so use vi.hoisted for shared mock fns.
const { generateTextMock, streamTextMock, convertToModelMessagesMock, stepCountIsMock, workersaiFactoryMock } =
  vi.hoisted(() => ({
    generateTextMock: vi.fn(),
    streamTextMock: vi.fn(),
    convertToModelMessagesMock: vi.fn(async (msgs: unknown) => msgs),
    stepCountIsMock: vi.fn(() => () => false),
    workersaiFactoryMock: vi.fn(),
  }));

vi.mock("@cloudflare/ai-chat", () => ({
  AIChatAgent: class {
    env: unknown;
    name: string;
    messages: unknown[] = [];
    constructor(_ctx: unknown, env: unknown) {
      this.env = env;
      this.name = "alice@example.com";
    }
    async persistMessages(msgs: unknown[]) {
      this.messages = msgs;
    }
    async onRequest(_req: Request) {
      return new Response("base");
    }
  },
}));

vi.mock("ai", () => ({
  streamText: streamTextMock,
  generateText: generateTextMock,
  convertToModelMessages: convertToModelMessagesMock,
  stepCountIs: stepCountIsMock,
}));

vi.mock("workers-ai-provider", () => ({
  createWorkersAI: workersaiFactoryMock,
}));

vi.mock("workers/lib/ai", () => ({
  verifyDraft: vi.fn(async (_ai: unknown, body: string) => body),
  isPromptInjection: vi.fn(async () => false),
}));

import { EmailAgent } from "workers/agent";
import { verifyDraft, isPromptInjection } from "workers/lib/ai";
import { DEFAULT_AGENT_MODEL, AUTOROUTE_FALLBACKS, AUTOROUTE_SENTINEL } from "shared/models";
import type { Env } from "workers/types";

// ── Mock env ────────────────────────────────────────────────────────

function createMockEnv(mailboxSettings: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  store.set("mailboxes/alice@example.com.json", JSON.stringify(mailboxSettings));
  const stub = {
    getEmail: vi.fn(async () => ({
      id: "e1",
      subject: "Hello",
      sender: "bob@example.com",
      recipient: "alice@example.com",
      date: "2026-01-01T00:00:00.000Z",
      read: true,
      starred: false,
      body: "<p>Original body</p>",
      thread_id: "t1",
      message_id: "msg-1",
    })),
    getEmails: vi.fn(async () => []),
    createEmail: vi.fn(async () => {}),
  };
  const env = {
    BUCKET: {
      get: vi.fn(async (key: string) => {
        const v = store.get(key);
        return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
      }),
      head: vi.fn(async () => null),
      put: vi.fn(async () => {}),
    } as unknown as R2Bucket,
    AI: { run: vi.fn(async () => ({ response: "NO" })) } as unknown as Ai,
    MAILBOX: {
      idFromName: vi.fn((n: string) => n as unknown as DurableObjectId),
      get: vi.fn(() => stub as unknown as DurableObjectStub<unknown>),
    } as unknown as DurableObjectNamespace,
    _stub: stub,
  } as unknown as Env & { _stub: typeof stub };
  return env;
}

function createAgent(env: Env) {
  return new EmailAgent({} as unknown as DurableObjectState, env);
}

const NEW_EMAIL = {
  mailboxId: "alice@example.com",
  emailId: "e1",
  sender: "bob@example.com",
  subject: "Hello",
  threadId: "t1",
};

// ── Gated auto-draft ────────────────────────────────────────────────

describe("EmailAgent.handleNewEmail gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workersaiFactoryMock.mockReturnValue(vi.fn());
    generateTextMock.mockResolvedValue({ steps: [], text: "" });
  });

  it("skips when agentAutoDraft is false (no AI call)", async () => {
    const env = createMockEnv({ agentAutoDraft: false });
    const agent = createAgent(env);
    const result = await agent.handleNewEmail(NEW_EMAIL);
    expect(result).toEqual({ status: "skipped", reason: "auto_draft_disabled" });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it("skips when agentAutoDraft is missing (default off)", async () => {
    const env = createMockEnv({});
    const agent = createAgent(env);
    const result = await agent.handleNewEmail(NEW_EMAIL);
    expect(result).toEqual({ status: "skipped", reason: "auto_draft_disabled" });
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("blocks when prompt injection detected in email body", async () => {
    vi.mocked(isPromptInjection).mockResolvedValueOnce(true);
    const env = createMockEnv({ agentAutoDraft: true });
    const agent = createAgent(env);
    const result = await agent.handleNewEmail(NEW_EMAIL);
    expect(result).toBeUndefined();
    expect(generateTextMock).not.toHaveBeenCalled();
    // Persisted a blocked notice to chat
    expect(agent.messages.length).toBe(2);
    const assistantMsg = agent.messages[1] as { content: string };
    expect(assistantMsg.content).toContain("Blocked auto-draft");
  });

  it("blocks when prompt injection detected in thread context", async () => {
    // First call (email body) is clean, second (thread context) is injection
    vi.mocked(isPromptInjection)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const env = createMockEnv({ agentAutoDraft: true });
    // Two emails in the thread so threadContext is built
    env._stub.getEmails = vi.fn(async () => [
      { id: "e1", sender: "a@ex.com", recipient: "b@ex.com", subject: "Hi", date: "2026-01-01", folder_id: "inbox" },
      { id: "e2", sender: "b@ex.com", recipient: "a@ex.com", subject: "Hi", date: "2026-01-02", folder_id: "inbox" },
    ]);
    const agent = createAgent(env);
    const result = await agent.handleNewEmail(NEW_EMAIL);
    expect(result).toBeUndefined();
    expect(generateTextMock).not.toHaveBeenCalled();
    const assistantMsg = agent.messages[1] as { content: string };
    expect(assistantMsg.content).toContain("Blocked auto-draft");
  });

  it("returns error status when generateText throws", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("model exploded"));
    const env = createMockEnv({ agentAutoDraft: true });
    const agent = createAgent(env);
    const result = await agent.handleNewEmail(NEW_EMAIL);
    expect(result).toEqual({ status: "error", error: "model exploded" });
  });
});

// ── Model resolution + autoroute fallback ───────────────────────────

describe("EmailAgent model resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workersaiFactoryMock.mockReturnValue(vi.fn());
    generateTextMock.mockResolvedValue({ steps: [], text: "" });
  });

  it("uses DEFAULT_AGENT_MODEL when no per-mailbox setting", async () => {
    const env = createMockEnv({ agentAutoDraft: true });
    const agent = createAgent(env);
    await agent.handleNewEmail(NEW_EMAIL);
    const modelFn = workersaiFactoryMock.mock.results[0].value as ReturnType<typeof vi.fn>;
    expect(modelFn).toHaveBeenCalledWith(
      DEFAULT_AGENT_MODEL,
      expect.objectContaining({ fallback: expect.objectContaining({ mode: "client" }) }),
    );
  });

  it("uses per-mailbox model when set", async () => {
    const custom = "@cf/meta/llama-4-scout-17b-16e-instruct";
    const env = createMockEnv({ agentAutoDraft: true, agentModel: custom });
    const agent = createAgent(env);
    await agent.handleNewEmail(NEW_EMAIL);
    const modelFn = workersaiFactoryMock.mock.results[0].value as ReturnType<typeof vi.fn>;
    expect(modelFn).toHaveBeenCalledWith(custom, expect.anything());
  });

  it("autoroute sentinel resolves to default with fallback chain", async () => {
    const env = createMockEnv({ agentAutoDraft: true, agentModel: AUTOROUTE_SENTINEL });
    const agent = createAgent(env);
    await agent.handleNewEmail(NEW_EMAIL);
    const modelFn = workersaiFactoryMock.mock.results[0].value as ReturnType<typeof vi.fn>;
    const [primary, opts] = modelFn.mock.calls[0] as [string, { fallback: { models: string[] } }];
    expect(primary).toBe(DEFAULT_AGENT_MODEL);
    expect(opts.fallback.models).toEqual(
      [...AUTOROUTE_FALLBACKS].filter((m) => m !== DEFAULT_AGENT_MODEL),
    );
  });

  it("custom primary is excluded from fallback chain", async () => {
    const custom = AUTOROUTE_FALLBACKS[0];
    const env = createMockEnv({ agentAutoDraft: true, agentModel: custom });
    const agent = createAgent(env);
    await agent.handleNewEmail(NEW_EMAIL);
    const modelFn = workersaiFactoryMock.mock.results[0].value as ReturnType<typeof vi.fn>;
    const [primary, opts] = modelFn.mock.calls[0] as [string, { fallback: { models: string[] } }];
    expect(primary).toBe(custom);
    expect(opts.fallback.models).not.toContain(custom);
  });
});

// ── Inline draft fallback (verifyDraft blank-save guard) ────────────

describe("EmailAgent inline draft fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workersaiFactoryMock.mockReturnValue(vi.fn());
  });

  it("saves inline text as draft when verifyDraft returns non-blank", async () => {
    generateTextMock.mockResolvedValueOnce({
      steps: [], // no draft tool called
      text: "Here is a clean reply with enough business content to verify.",
    });
    vi.mocked(verifyDraft).mockResolvedValueOnce(
      "Here is a clean reply with enough business content to verify.",
    );
    const env = createMockEnv({ agentAutoDraft: true });
    const agent = createAgent(env);
    const result = await agent.handleNewEmail(NEW_EMAIL);
    expect(result).toMatchObject({ status: "draft_generated" });
    expect(env._stub.createEmail).toHaveBeenCalled();
    const created = env._stub.createEmail.mock.calls[0];
    expect(created[0]).toBe("draft");
    expect(created[1].in_reply_to).toBe("e1");
  });

  it("skips draft save when verifyDraft returns blank (blank-save guard)", async () => {
    generateTextMock.mockResolvedValueOnce({
      steps: [],
      text: "Draft created. The operator can review.",
    });
    vi.mocked(verifyDraft).mockResolvedValueOnce(""); // AI failure -> empty
    const env = createMockEnv({ agentAutoDraft: true });
    const agent = createAgent(env);
    const result = await agent.handleNewEmail(NEW_EMAIL);
    expect(result).toMatchObject({ status: "draft_generated" });
    // No draft saved because verification returned blank
    expect(env._stub.createEmail).not.toHaveBeenCalled();
  });

  it("does not inline-save when draft tool was called", async () => {
    generateTextMock.mockResolvedValueOnce({
      steps: [{ toolCalls: [{ toolName: "draft_reply" }] }],
      text: "Created draft reply to bob@example.com.",
    });
    const env = createMockEnv({ agentAutoDraft: true });
    const agent = createAgent(env);
    await agent.handleNewEmail(NEW_EMAIL);
    // createEmail not called by the inline fallback path (tool handles it)
    expect(env._stub.createEmail).not.toHaveBeenCalled();
    // Chat persisted with simple success message
    const assistantMsg = agent.messages[1] as { content: string };
    expect(assistantMsg.content).toContain("Created draft reply");
  });
});
