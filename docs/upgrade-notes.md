# Upgrade Notes — Dependency Majors (2026-08)

> Staged major upgrades completed from `docs/plan.md` P3. Full audit history: `docs/tech-debt.md`.

## What moved together

**Stage 1 (coupled):** `agents` 0.7.6 → 0.21.0 + `@cloudflare/ai-chat` 0.1.8 → 0.10.2 + `zod` 3.25.76 → 4.4.3 + `@modelcontextprotocol/sdk` 1.26.0 → 1.30.0.

`agents` 0.8+ already requires `zod` ^4 and 0.21 requires MCP SDK 1.30 — the original plan order (`agents` first, then `zod` separately) is not feasible. Bump the four together.

**Stage 2:** `react-router` 7.18.2 → 8.3.0 (+ `@react-router/dev`). Remove `future.v8_viteEnvironmentApi` from `react-router.config.ts` (always-on in v8). The other four `future.v8_*` flags still warn at dev startup — harmless until adopted.

**Patch/minor:** `@cloudflare/vite-plugin` 1.53.0 → 1.53.1, `wrangler` 4.124 → 4.125. `@tiptap/*` 3.20.2 → 3.30.2 was attempted and reverted (`getStyleProperty` missing — `@tiptap/core` export mismatch, jsdom failure); pinned at 3.20.2. Keep `@vitest/coverage-v8` at 4.1.10 — `vite-plus` bundles `vitest` 4.1.10, 4.1.11 breaks `vp test run --coverage` (version-mismatch gate).

## Fixes required by the majors

1. **`workers/index.ts`** — `z.record(z.any())` → `z.record(z.string(), z.any())` (zod 4 requires explicit key schema).
2. **`workers/mcp/index.ts`** — `server.registerTool` now takes a raw-shape `inputSchema` (`{ mailboxId, ...fields }`) instead of `z.object(...)`; generics narrowed with zod 4. Bridged with a narrow `as any` cast, guarded by `mailboxTool` integration tests (`tests/integration/mcp.test.ts`).
3. **`workers/app.ts` + `app/entry.server.tsx`** — RR8 `createRequestHandler` takes a `RouterContextProvider`, not a plain `AppLoadContext` object. Use `createContext` + `RouterContextProvider` (`cloudflareContext`).

All 349 tests, `vp check`, `vp run build` green.

## Deferred (one major per quarter)

- `@cloudflare/kumo` 1 → 2, `workers-ai-provider` 3 → 4 with `ai` 6 → 7, `@cloudflare/workers-types` 4 → 5, `typescript` 5 → 7, `jsdom` 26 → 30.

Patch/minor bumps may be applied anytime.
