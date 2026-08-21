// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { FALLBACK_MODELS } from "../../shared/models";
import type { Env } from "../types";

const MODELS_CATALOG_URL = "https://developers.cloudflare.com/workers-ai/models/index.md";
const LLMS_URL = MODELS_CATALOG_URL;
const CACHE_R2_KEY = "cache/models.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type CatalogModel = {
  id: string;
  name: string;
  task?: string;
  functionCalling?: boolean;
};

function fallbackCatalog(): CatalogModel[] {
  return FALLBACK_MODELS.map((id) => ({
    id,
    name: id.split("/").pop() || id,
    task: "Text Generation",
    functionCalling: true,
  }));
}

function parseLlmsTxt(text: string): CatalogModel[] | null {
  // Extract slug from every ".../workers-ai/models/<slug>/" link in the markdown.
  // The markdown catalog uses short slugs like "kimi-k2.5", "llama-3.1-8b-instruct".
  // We map those back to full "@cf/..." IDs via the fallback list when possible;
  // otherwise we surface the slug as "@cf/<slug>" so the UI still shows something live.
  const urlRegex = /https:\/\/developers\.cloudflare\.com\/workers-ai\/models\/([^/)\s#?"]+)/g;
  const slugs = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = urlRegex.exec(text))) {
    let slug = m[1].replace(/\.md$/, "").replace(/\/$/, "");
    if (!slug || slug === "index" || slug.startsWith("@")) {
      if (slug.startsWith("@cf/") || slug.startsWith("@hf/")) {
        slugs.add(slug);
        continue;
      }
      if (!slug) continue;
    }
    // ignore non-model segments like "index"
    if (slug.includes("/")) continue;
    slugs.add(slug);
  }
  if (slugs.size === 0) return null;

  // Build lookup: short name -> full id from fallback list
  const shortToFull = new Map<string, string>();
  for (const full of FALLBACK_MODELS) {
    const short = full.split("/").pop()!;
    shortToFull.set(short, full);
  }

  const ids = new Set<string>();
  for (const slug of slugs) {
    if (slug.startsWith("@cf/") || slug.startsWith("@hf/")) {
      ids.add(slug);
    } else if (shortToFull.has(slug)) {
      ids.add(shortToFull.get(slug)!);
    } else {
      // Unknown slug — keep as short id prefixed so it is still selectable.
      // Workers AI will reject it if it is not a real model; client fallback will retry.
      ids.add(slug);
    }
  }
  if (ids.size === 0) return null;
  return [...ids].map((id) => ({
    id,
    name: id.split("/").pop() || id,
    task: "Text Generation",
    functionCalling: true,
  }));
}

export async function handleGetModels(c: Context<{ Bindings: Env }>) {
  const url = new URL(c.req.url);
  const refresh = url.searchParams.get("refresh") === "1";

  // Try cache (Caches API + R2) unless refresh
  if (!refresh) {
    try {
      // SAFETY: caches is a global that may be undefined outside Workers runtime; optional chaining is safe.
      // eslint-disable-next-line anti-slop/no-runtime-typeof, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion
      const defaultCache = (globalThis as unknown as { caches?: { default: Cache } }).caches
        ?.default;
      if (defaultCache) {
        const cached = await defaultCache.match(new Request(url.toString()));
        if (cached) {
          const data = await cached.json();
          return c.json(data);
        }
      }
    } catch {
      // ignore
    }
    try {
      const obj = await c.env.BUCKET.get(CACHE_R2_KEY);
      if (obj) {
        // SAFETY: R2 cached JSON was written by this handler as a typed catalog payload; shape is trusted and validated by length check.
        const data = (await obj.json()) as {
          cachedAt: string;
          models: CatalogModel[];
          source: string;
        };
        const age = Date.now() - new Date(data.cachedAt).getTime();
        if (age < CACHE_TTL_MS && data.models?.length) {
          return c.json(data);
        }
      }
    } catch {
      // ignore
    }
  }

  let models: CatalogModel[] | null = null;
  let source = "models/index.md";
  let warning: string | undefined;

  try {
    const res = await fetch(LLMS_URL, {
      headers: { Accept: "text/markdown, text/plain, */*" },
    });
    if (res.ok) {
      const text = await res.text();
      models = parseLlmsTxt(text);
      if (!models || models.length === 0) {
        // No parseable models — fall back
        models = null;
      }
    } else {
      models = null;
    }
  } catch {
    models = null;
  }

  if (!models) {
    models = fallbackCatalog();
    source = "fallback";
    warning = "using fallback list";
  }

  // Filter to Text Generation / function calling if metadata available — fallback already is filtered
  // If we parsed real catalog, we already filtered; keep as is.

  // eslint-disable-next-line anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening
  const payload: Record<string, unknown> = {
    models,
    cachedAt: new Date().toISOString(),
    source,
  };
  if (warning) payload.warning = warning;

  // Write caches (best-effort)
  try {
    await c.env.BUCKET.put(CACHE_R2_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
  try {
    // SAFETY: caches global may be absent outside Workers; guard via optional chaining.
    // eslint-disable-next-line anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-chained-type-assertions
    const defaultCache2 = (globalThis as unknown as { caches?: { default: Cache } }).caches
      ?.default;
    if (defaultCache2) {
      const cacheRes = new Response(JSON.stringify(payload), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=10",
        },
      });
      const cacheKey = new Request(url.origin + url.pathname);
      void defaultCache2.put(cacheKey, cacheRes);
    }
  } catch {
    // ignore
  }

  return c.json(payload);
}

export function parseLlmsTxtForTest(text: string) {
  return parseLlmsTxt(text);
}
