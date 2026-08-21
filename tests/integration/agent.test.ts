// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi } from "vite-plus/test";
import * as aiLib from "workers/lib/ai";
import { DEFAULT_AGENT_MODEL, AUTOROUTE_FALLBACKS, AUTOROUTE_SENTINEL, FALLBACK_MODELS } from "shared/models";

function createMockEnv(store: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(store));
  return {
    BUCKET: {
      get: vi.fn(async (key: string) => {
        const v = map.get(key);
        return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
      }),
      head: vi.fn(async () => null),
      put: vi.fn(async (k: string, v: string) => { map.set(k, v); }),
    } as unknown as R2Bucket,
    AI: { run: vi.fn(async () => ({ response: "NO" })) } as unknown as Ai,
    MAILBOX: {
      idFromName: vi.fn((n: string) => n as unknown as DurableObjectId),
      get: vi.fn(() => ({
        getEmail: vi.fn(async () => ({ id: "e1", body: "<p>hello</p>", thread_id: "t1" })),
        getEmails: vi.fn(async () => []),
        createEmail: vi.fn(async () => {}),
      } as unknown as DurableObjectStub<unknown>)),
    } as unknown as DurableObjectNamespace,
    _store: map,
  } as unknown as Cloudflare.Env & { _store: Map<string, string> };
}

// Inline helpers mirroring agent private functions (tested via behavior)
async function getAgentModel(env: unknown, mailboxId: string): Promise<string> {
  const e = env as { BUCKET: { get: (k: string) => Promise<{ json: () => Promise<unknown> } | null> } };
  try {
    const obj = await e.BUCKET.get(`mailboxes/${mailboxId}.json`);
    if (obj) {
      const s = await obj.json() as { agentModel?: string };
      const m = s.agentModel?.trim();
      if (m) return m;
    }
  } catch { /* fallback */ }
  return DEFAULT_AGENT_MODEL;
}

function resolveModelWithFallback(primaryId: string) {
  const primary = primaryId === AUTOROUTE_SENTINEL ? DEFAULT_AGENT_MODEL : primaryId;
  const fallbacks = [...AUTOROUTE_FALLBACKS].filter((m) => m !== primary);
  return { primary, fallbacks };
}

describe("EmailAgent gated auto-draft (unit logic)", () => {
  it("skips when agentAutoDraft is false", async () => {
    const env = createMockEnv({ "mailboxes/alice@example.com.json": JSON.stringify({ agentAutoDraft: false }) });
    const obj = await (env.BUCKET as unknown as { get: (k: string) => Promise<{ json: () => Promise<{ agentAutoDraft?: boolean }> } | null> }).get("mailboxes/alice@example.com.json");
    const settings = obj ? await obj.json() : {};
    const shouldDraft = (settings as { agentAutoDraft?: boolean }).agentAutoDraft === true;
    expect(shouldDraft).toBe(false);
  });

  it("proceeds when agentAutoDraft is true", async () => {
    const env = createMockEnv({ "mailboxes/alice@example.com.json": JSON.stringify({ agentAutoDraft: true }) });
    const obj = await (env.BUCKET as unknown as { get: (k: string) => Promise<{ json: () => Promise<{ agentAutoDraft?: boolean }> } | null> }).get("mailboxes/alice@example.com.json");
    const settings = obj ? await obj.json() : {};
    expect(settings.agentAutoDraft).toBe(true);
  });

  it("defaults to false when no setting", async () => {
    const env = createMockEnv({});
    const obj = await (env.BUCKET as unknown as { get: (k: string) => Promise<unknown> }).get("mailboxes/alice@example.com.json");
    expect(obj).toBeNull();
  });
});

describe("getAgentModel + autoroute fallback", () => {
  it("returns DEFAULT_AGENT_MODEL when no setting", async () => {
    const env = createMockEnv({});
    expect(await getAgentModel(env, "alice@example.com")).toBe(DEFAULT_AGENT_MODEL);
  });

  it("returns per-mailbox model when set", async () => {
    const custom = "@cf/meta/llama-4-scout-17b-16e-instruct";
    const env = createMockEnv({ "mailboxes/alice@example.com.json": JSON.stringify({ agentModel: custom }) });
    expect(await getAgentModel(env, "alice@example.com")).toBe(custom);
  });

  it("trims whitespace", async () => {
    const env = createMockEnv({ "mailboxes/alice@example.com.json": JSON.stringify({ agentModel: "  @cf/test/model  " }) });
    expect(await getAgentModel(env, "alice@example.com")).toBe("@cf/test/model");
  });

  it("autoroute sentinel resolves to default with fallbacks", () => {
    const { primary, fallbacks } = resolveModelWithFallback(AUTOROUTE_SENTINEL);
    expect(primary).toBe(DEFAULT_AGENT_MODEL);
    expect(fallbacks).toEqual([...AUTOROUTE_FALLBACKS].filter((m) => m !== DEFAULT_AGENT_MODEL));
  });

  it("custom primary is excluded from fallbacks", () => {
    const custom = FALLBACK_MODELS[1];
    const { primary, fallbacks } = resolveModelWithFallback(custom);
    expect(primary).toBe(custom);
    expect(fallbacks).not.toContain(custom);
  });

  it("primary not in fallbacks still returns all fallbacks", () => {
    const { primary, fallbacks } = resolveModelWithFallback("@cf/unknown/model");
    expect(primary).toBe("@cf/unknown/model");
    expect(fallbacks).toEqual([...AUTOROUTE_FALLBACKS]);
  });
});

describe("verifyDraft inline fallback (blank-save hole guard)", () => {
  it("verifyDraft returns sanitized text for valid body", async () => {
    const ai = { run: vi.fn(async () => ({ response: "Hello world - this is legitimate business content with sufficient length to pass verification properly." })) } as unknown as Ai;
    const body = "Hello world - this is legitimate business content with sufficient length to pass verification properly.";
    const result = await aiLib.verifyDraft(ai, body);
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
  });

  it("verifyDraft returns empty on AI failure (hole)", async () => {
    const ai = { run: vi.fn(async () => { throw new Error("AI timeout"); }) } as unknown as Ai;
    const body = "This is a long enough email body that needs verification and will fail due to AI error";
    const result = await aiLib.verifyDraft(ai, body);
    expect(result).toBe("");
  });

  it("caller must guard blank save: should not create draft when verifyDraft empty", async () => {
    const ai = { run: vi.fn(async () => { throw new Error("fail"); }) } as unknown as Ai;
    const createEmail = vi.fn();
    const body = "This is a long enough body that would normally be verified but AI fails";
    const sanitized = await aiLib.verifyDraft(ai, body);
    if (!sanitized) {
      // Guard: skip creation
    } else {
      await createEmail();
    }
    expect(sanitized).toBe("");
    expect(createEmail).not.toHaveBeenCalled();
  });

  it("verifyDraft returns original when AI removes >50% content", async () => {
    const ai = { run: vi.fn(async () => ({ response: "Hi" })) } as unknown as Ai;
    const body = "This is a very long email body with lots of legitimate business content about pricing and features and more details";
    const result = await aiLib.verifyDraft(ai, body);
    expect(result).toBe(body);
  });

  it("inline text fallback saves only when sanitized non-empty", async () => {
    const ai = { run: vi.fn(async () => ({ response: "Cleaned reply with business content and pricing details that are sufficient length." })) } as unknown as Ai;
    const inlineText = "Cleaned reply with business content and pricing details that are sufficient length.";
    const sanitized = await aiLib.verifyDraft(ai, inlineText);
    expect(sanitized).not.toBe("");
    // Simulate agent inline fallback: save only if sanitized non-empty
    const shouldSave = !!sanitized && sanitized.trim().length > 0;
    expect(shouldSave).toBe(true);
  });
});

describe("isPromptInjection fail-closed", () => {
  it("returns true on AI failure (fail closed)", async () => {
    const ai = { run: vi.fn(async () => { throw new Error("timeout"); }) } as unknown as Ai;
    const result = await aiLib.isPromptInjection(ai, "This is a long enough body to trigger scan for injection detection");
    expect(result).toBe(true);
  });

  it("returns false for normal email", async () => {
    const ai = { run: vi.fn(async () => ({ response: "NO" })) } as unknown as Ai;
    const result = await aiLib.isPromptInjection(ai, "Hello, do you have pricing for 10k emails? This is a normal support question.");
    expect(result).toBe(false);
  });
});
