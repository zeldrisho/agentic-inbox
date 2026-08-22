// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { handleGetModels } from "workers/routes/models";
import { FALLBACK_MODELS } from "shared/models";

type SearchObject = {
  id: string;
  source: number;
  name: string;
  description: string;
  task: { id: string; name: string; description: string };
  tags: string[];
  properties: { property_id: string; value: string }[];
};

function makeModel(name: string, extra: Record<string, unknown> = {}): SearchObject {
  return {
    id: name,
    source: 1,
    name,
    description: `${name} description`,
    task: { id: "c3f111d6-7a2e-4c0d-8d3e-00f1e0f1f7c8", name: "Text Generation", description: "" },
    tags: [],
    properties: [],
    ...extra,
  };
}

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

function mockAi(results?: SearchObject[], error = false) {
  return {
    models: vi.fn(async () => {
      if (error) throw new Error("binding unavailable");
      // SAFETY: runtime payload may carry untyped deprecation metadata.
      return (results ?? []) as unknown as Awaited<ReturnType<Ai["models"]>>;
    }),
  };
}

function mockContext(
  bucket: ReturnType<typeof mockBucket>,
  url: string,
  ai: ReturnType<typeof mockAi>,
) {
  const json = vi.fn((payload: unknown, status?: number) => new Response(JSON.stringify(payload), { status }));
  return {
    req: { url },
    env: { BUCKET: bucket as unknown as R2Bucket, AI: ai as unknown as Ai },
    json,
  } as unknown as Parameters<typeof handleGetModels>[0];
}

describe("handleGetModels", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns fallback catalog when the AI binding fails", async () => {
    const bucket = mockBucket();
    const ai = mockAi(undefined, true);
    const c = mockContext(bucket, "http://localhost/api/v1/models", ai);
    await handleGetModels(c);
    const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.source).toBe("fallback");
    expect(payload.warning).toBe("using fallback list");
    expect((payload.models as { id: string }[]).map((m) => m.id)).toEqual([...FALLBACK_MODELS]);
  });

  it("returns live catalog from the AI binding and caches to R2", async () => {
    const bucket = mockBucket();
    const ai = mockAi([makeModel("@cf/test/small"), makeModel("@cf/test/large")]);
    const c = mockContext(bucket, "http://localhost/api/v1/models", ai);
    await handleGetModels(c);
    const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.source).toBe("ai-models-search");
    expect(payload.warning).toBeUndefined();
    // Sorted by id
    expect((payload.models as { id: string }[]).map((m) => m.id)).toEqual([
      "@cf/test/large",
      "@cf/test/small",
    ]);
    expect(ai.models).toHaveBeenCalledWith({ task: "Text Generation" });
    expect(bucket.put).toHaveBeenCalled();
    expect(bucket._store.has("cache/models.json")).toBe(true);
  });

  it("filters deprecated models out of the live catalog", async () => {
    const bucket = mockBucket();
    const ai = mockAi([
      makeModel("@cf/test/active"),
      makeModel("@cf/test/deprecated", { deprecated: true }),
    ]);
    const c = mockContext(bucket, "http://localhost/api/v1/models", ai);
    await handleGetModels(c);
    const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const ids = (payload.models as { id: string }[]).map((m) => m.id);
    expect(ids).toContain("@cf/test/active");
    expect(ids).not.toContain("@cf/test/deprecated");
  });

  it("serves fresh R2 cache without calling the AI binding", async () => {
    const bucket = mockBucket();
    bucket._store.set(
      "cache/models.json",
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        models: [{ id: "@cf/test/model", name: "model" }],
        source: "ai-models-search",
      }),
    );
    const ai = mockAi();
    const c = mockContext(bucket, "http://localhost/api/v1/models", ai);
    await handleGetModels(c);
    const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect((payload.models as { id: string }[])[0].id).toBe("@cf/test/model");
    expect(ai.models).not.toHaveBeenCalled();
  });

  it("refresh=1 bypasses cache and re-queries the binding", async () => {
    const bucket = mockBucket();
    bucket._store.set(
      "cache/models.json",
      JSON.stringify({
        cachedAt: new Date().toISOString(),
        models: [{ id: "@cf/stale/model", name: "stale" }],
        source: "ai-models-search",
      }),
    );
    const ai = mockAi(undefined, true);
    const c = mockContext(bucket, "http://localhost/api/v1/models?refresh=1", ai);
    await handleGetModels(c);
    const payload = (c.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // refresh bypassed the stale cache and fell back
    expect(payload.source).toBe("fallback");
    expect(ai.models).toHaveBeenCalled();
  });
});
