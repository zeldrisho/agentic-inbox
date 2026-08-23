// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Fallback model catalog used when Workers AI model list fetch fails.
 * Shared by Worker and tests.
 */
export const FALLBACK_MODELS = [
  "@cf/moonshotai/kimi-k2.5",
  "@cf/moonshotai/kimi-k2.6",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen3-30b-a3b-fp8",
  "@cf/google/gemma-3-12b-it",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
] as const;

export type FallbackModelId = (typeof FALLBACK_MODELS)[number];

/** Sentinel value meaning "use Workers AI autoroute (client fallback chain)". */
export const AUTOROUTE_SENTINEL = "autoroute" as const;

export type AgentModelId = FallbackModelId | typeof AUTOROUTE_SENTINEL | (string & {});

/**
 * Resolved default model when no mailbox or global config is present.
 */
export const DEFAULT_AGENT_MODEL: FallbackModelId = "@cf/moonshotai/kimi-k2.5";

/**
 * Autoroute fallback chain used for Workers AI client fallback.
 * Primary is prepended dynamically; these are the legs after primary.
 */
export const AUTOROUTE_FALLBACKS: readonly string[] = [
  "@cf/moonshotai/kimi-k2.6",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/qwen/qwen3-30b-a3b-fp8",
] as const;
