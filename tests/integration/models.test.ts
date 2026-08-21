// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { handleGetModels, parseLlmsTxtForTest } from "workers/routes/models";
import { FALLBACK_MODELS } from "shared/models";

function mockBucket() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => {
      const v = store.get(key);
      return v ? ({ json: async () => JSON.parse(v) } as unknown as R2ObjectBody) : null;
    }),
    put: vi.fn(async (key: string, val: string) => {
      store.set(key, val);
    }),
    _store: store,
  };
}

function mockContext(bucket: ReturnType<typeof mockBucket>, url: string) {
  const json = vi.fn((payload: unknown, status?: number) => new Response(JSON.stringify(payload), { status }));
  return {
    req: { url },
    env: { BUCKET: bucket as unknown as R2Bucket },
    json,
  } as unknown as Parameters<typeof handleGetModels>[0];
}

describe("parseLlmsTxtForTest", () => {
  it("returns null for empty text", () => {
    expect(parseLlmsTxtForTest("")).toBeNull();
    expect(parseLlmsTxtForTest("no links here")).toBeNull();
  });

  it("parses model slugs from markdown catalog", () => {
    const md = [
      "## Models",
      "- [Kimi K2.5](https://developers.cloudflare.com/workers-ai/models/kimi-k2.5/)",
      "- [Llama 3.1](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct)",
      "- [Qwen](https://developers.cloudflare.com/workers-ai/models/qwen3-30b-a3b-fp8.md)",
    ].join("\n");
    const result = parseLlmsTxtForTest(md);
    expect(result).not.toBeNull();
    const ids = result!.map((m) => m.id);
    // kimi-k2.5 maps to full fallback id
    expect(ids).toContain("@cf/moonshotai/kimi-k2.5");
    // llama-3.1-8b-instruct is unknown slug -> omitted (not in fallback list)
    expect(ids).not.toContain("llama-3.1-8b-instruct");
    expect(ids).toContain("@cf/qwen/qwen3-30b-a3b-fp8");
  });

  it("omits unknown slugs and falls back when no resolvable models remain", () => {
    const md = "- [Unknown](https://developers.cloudflare.com/workers-ai/models/unknown-model-slug/)";
    const result = parseLlmsTxtForTest(md);
    // Unknown slug is omitted, leaving zero models -> returns null
    expect(result).toBeNull();
  });

  it("ignores index and non-model segments", () => {
    const md =
      "https://developers.cloudflare.com/workers-ai/models/index/ and https://developers.cloudflare.com/workers-ai/models/";
    expect(parseLlmsTxtForTest(md)).toBeNull();
  });

  it("skips bare @ segments that are not full model ids", () => {
    const md = "https://developers.cloudflare.com/workers-ai/models/@cf";
    expect(parseLlmsTxtForTest(md)).toBeNull();
  });
});

describe("handleGetModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fallback catalog when fetch fails", async () => {
    const bucket = mockBucket();
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    try {
      const c = mockContext(bucket, "http://localhost/api/v1/models");
      await handleGetModels(c);
      const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(payload.source).toBe("fallback");
      expect(payload.warning).toBe("using fallback list");
      expect(payload.models.map((m: { id: string }) => m.id)).toEqual([...FALLBACK_MODELS]);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("parses live catalog and caches to R2", async () => {
    const bucket = mockBucket();
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          "- [Kimi](https://developers.cloudflare.com/workers-ai/models/kimi-k2.5/)",
          { status: 200 },
        ),
    ) as unknown as typeof fetch;
    try {
      const c = mockContext(bucket, "http://localhost/api/v1/models");
      await handleGetModels(c);
      const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(payload.source).toBe("models/index.md");
      expect(payload.warning).toBeUndefined();
      expect(bucket.put).toHaveBeenCalled();
      expect(bucket._store.has("cache/models.json")).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("serves fresh R2 cache without fetching", async () => {
    const bucket = mockBucket();
    bucket._store.set(
      "cache/models.json",
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        models: [{ id: "@cf/test/model", name: "model" }],
        source: "models/index.md",
      }),
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    try {
      const c = mockContext(bucket, "http://localhost/api/v1/models");
      await handleGetModels(c);
      const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(payload.models[0].id).toBe("@cf/test/model");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("refresh=1 bypasses cache and refetches", async () => {
    const bucket = mockBucket();
    bucket._store.set(
      "cache/models.json",
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        models: [{ id: "@cf/stale/model", name: "stale" }],
        source: "models/index.md",
      }),
    );
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 500 }),
    ) as unknown as typeof fetch;
    try {
      const c = mockContext(bucket, "http://localhost/api/v1/models?refresh=1");
      await handleGetModels(c);
      const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      // refresh bypassed the stale cache and fell back
      expect(payload.source).toBe("fallback");
      expect(globalThis.fetch).toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
