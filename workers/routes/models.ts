// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { FALLBACK_MODELS } from "../../shared/models";
import type { Env } from "../types";

const CACHE_R2_KEY = "cache/models.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

type CatalogModel = {
  id: string;
  name: string;
  task?: string;
  functionCalling?: boolean;
};

/**
 * Creates catalog entries from the configured fallback model identifiers.
 *
 * @returns Fallback model entries with derived names, a text-generation task, and function-calling support enabled.
 */
function fallbackCatalog(): CatalogModel[] {
  return FALLBACK_MODELS.map((id) => ({
    id,
    name: id.split("/").pop() || id,
    task: "Text Generation",
    functionCalling: true,
  }));
}

/**
 * Fetches the live Workers AI catalog through the AI binding's model search
 * (the same backend as `GET /accounts/{account_id}/ai/models/search`). The
 * API hides models past their planned deprecation date by default; entries
 * that still report `deprecated: true` are filtered out defensively so the
 * selector never offers a model the platform is retiring.
 *
 * @param ai - The Workers AI binding
 * @returns Live catalog entries sorted by id, or `null` if the search failed
 */
/**
 * Runtime search entry. Extends the generated `AiModelsSearchObject` with
 * deprecation metadata that the type does not model yet but the API returns.
 */
type SearchEntry = AiModelsSearchObject & { deprecated?: boolean };

/**
 * Retrieves and normalizes available text-generation models from Workers AI.
 *
 * @returns Sorted catalog models, or `null` when the catalog cannot be retrieved or contains no usable models.
 */
async function fetchLiveCatalog(ai: Ai): Promise<CatalogModel[] | null> {
  try {
    // SAFETY: the binding returns AiModelsSearchObject entries; the runtime payload additionally carries `deprecated`, modeled by SearchEntry.
    const raw = (await ai.models({ task: "Text Generation" })) as SearchEntry[];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    const models: CatalogModel[] = [];
    for (const m of raw) {
      if (!m.name || !m.name.startsWith("@")) continue;
      if (m.deprecated === true) continue;
      models.push({
        id: m.name,
        name: m.name.split("/").pop() || m.name,
        task: m.task?.name ?? "Text Generation",
        functionCalling: true,
      });
    }
    if (models.length === 0) return null;
    return models.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return null;
  }
}

/**
 * Retrieves the Workers AI model catalog, using cached data when available and falling back to a static catalog when the live catalog cannot be loaded.
 *
 * @returns The catalog payload containing models, cache timestamp, source, and an optional warning.
 */
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

  const live = await fetchLiveCatalog(c.env.AI);
  let models: CatalogModel[];
  let source: string;
  let warning: string | undefined;

  if (live) {
    models = live;
    source = "ai-models-search";
  } else {
    models = fallbackCatalog();
    source = "fallback";
    warning = "using fallback list";
  }

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
