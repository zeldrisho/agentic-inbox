# Development

How to build, run, and contribute to this fork.

## Prerequisites

- **Node.js** — the project is developed on Node 24; there is no `engines` field, so use a current LTS/24+.
- A **Cloudflare account** with:
  - A domain with [Email Routing](https://developers.cloudflare.com/email-routing/) enabled (receiving)
  - [Email Service](https://developers.cloudflare.com/email-service/) enabled (sending)
  - [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (the agent)
  - [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) configured for deployed/shared environments
- `wrangler` is installed via pnpm devDependencies — no global install required.

## Install

```bash
vp install
```

## Local development

```bash
vp run dev
```

Runs the React Router dev server through the Cloudflare Vite plugin. In development the worker **skips Cloudflare Access JWT validation** (see `workers/app.ts`), so the app is open on `localhost`. Inbound email delivery and the MCP server are only exercised on a real Cloudflare deployment.

## Type generation & typecheck

```bash
vp run cf-typegen   # generate worker-configuration.d.ts + env types from wrangler.jsonc
vp run typecheck    # cf-typegen + react-router typegen + tsc -b
```

`tsconfig.json` uses project references (`config/tsconfig.node.json`, `config/tsconfig.app.json`). Run `typecheck` after changing bindings, routes, `packages/shared/` types, or `worker-configuration.d.ts`.

## Build & deploy

```bash
vp run build     # react-router build
vp run deploy    # build + wrangler deploy
```

Deploying provisions R2, Durable Objects, and Workers AI. After deploying, follow the **After deploying** steps in `README.md` (configure Cloudflare Access, Email Routing, the `send_email` binding, and create a mailbox).

## Project layout

| Path                     | Purpose                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `app/`                   | React Router v7 SPA — `routes/`, `components/`, `services/api.ts`, `lib/`, `hooks/`, `types/`                       |
| `workers/index.ts`       | Hono API routes (`/api/v1/...`)                                                                                     |
| `workers/app.ts`         | Worker entry — Access middleware, `/mcp`, `/agents/*`, SPA fallback, `email` handler                                |
| `workers/durableObject/` | `MailboxDO` (SQLite + R2) and SQL migrations                                                                        |
| `workers/agent/`         | `EmailAgent` — `AIChatAgent` with 9 email tools and auto-draft                                                      |
| `workers/mcp/`           | `EmailMCP` — same tools over the Model Context Protocol                                                             |
| `workers/routes/`        | Compose helpers (`reply-forward.ts`)                                                                                |
| `workers/lib/`           | `mailbox.ts` (auth middleware), `tools.ts`, `ai.ts`, `email-helpers.ts`, `schemas.ts`, `attachments.ts`             |
| `workers/db/`            | Drizzle schema                                                                                                      |
| `packages/shared/`       | `folders.ts`, `dates.ts`, `models.ts`, `json.ts` — shared client/worker constants & helpers (aliased as `shared/*`) |
| `config/`                | Tooling configs (`tsconfig.app.json`, `tsconfig.node.json`)                                                         |
| `tests/`                 | Vitest suite — `tests/**/*.test.ts` mirrors `packages/shared/`, `workers/`, `app/` (`vite.config.ts: test`)         |
| `wrangler.jsonc`         | Bindings, Durable Object migrations (v1–v3), secrets                                                                |
| `.dev.vars.example`      | Template for local `POLICY_AUD` / `TEAM_DOMAIN`                                                                     |

## Configuration

- **`wrangler.jsonc`** defines:
  - `vars`: `EMAIL_ADDRESSES` (optional allowlist for mailbox creation/receipt)
  - `send_email`: `EMAIL` binding (remote)
  - `r2_buckets`: `BUCKET` (`agentic-inbox`)
  - `ai`: `AI` binding
  - Durable Objects: `MAILBOX` (`MailboxDO`), `EMAIL_AGENT` (`EmailAgent`), `EMAIL_MCP` (`EmailMCP`) with migrations `v1`–`v3`
- **Production secrets** (set via `wrangler secret put` or the deploy modal — see `.dev.vars.example`):
  - `POLICY_AUD` — Cloudflare Access policy audience
  - `TEAM_DOMAIN` — Access team URL or full `/cdn-cgi/access/certs` URL
  - `DOMAINS` — comma-separated Email Routing domains (secret so deploys/dashboard edits never override it)
- The worker **fails closed** in production if `POLICY_AUD` / `TEAM_DOMAIN` are unset (`workers/app.ts`).

## Workflow conventions

- Package manager is **pnpm**, managed by **Vite+ (`vp`)**; the lockfile is `pnpm-lock.yaml`.
- Lint/format/test is managed by Vite+ (`vp check`, `vp test` via `vite.config.ts:test`). Gate changes with `vp check` + `vp test` + `typecheck`/`build`.
- **Toolchain pinning (intentional, do not remove):** `vite` is aliased to `npm:@voidzero-dev/vite-plus-core@0.3.0` and `@oxlint/plugins` is pinned at `1.79.0` in `package.json`. `oxlint` itself is now provided by `vite-plus@0.3.0` (which bundles `oxlint@1.79.0`, matching the pin) so no top-level `oxlint` entry is needed — `vp` falls back to its bundled copy. The `vite` alias is required because `@react-router/dev`, `@cloudflare/vite-plugin`, and `@tailwindcss/vite` import the bare `vite` specifier and peer-depend on it (pnpm's strict isolation would otherwise fail to resolve it). `@oxlint/plugins` must stay pinned because the custom rules in `tools/oxlint/anti-slop/**` import it directly (`import { eslintCompatPlugin } from "@oxlint/plugins"`); pnpm's isolation prevents that import from resolving to `vite-plus`'s bundled copy, so removing the pin breaks `vp check` with `ERR_MODULE_NOT_FOUND`.
- Keep `workers/index.ts` route handlers thin; business logic lives in the Durable Objects (`workers/durableObject`, `workers/agent`, `workers/mcp`) and `workers/lib`.
- Shared client/worker code belongs in `packages/shared/` (import as `shared/*`).
- API request bodies are validated with Zod schemas in `workers/lib/schemas.ts` and inline in `workers/index.ts`.
- Assets: `docs/assets/demo.png` (moved from root `demo_app.png`).

## Known gaps

- Testing: unit + integration suites and a CI coverage gate are in place — see `docs/testing.md` for commands, thresholds, and Workers-mocking recipes. Browser E2E (Playwright) and branch coverage are complete. CI runs `vp check` → `vp test run --coverage` → `vp run build`.
- Lint/format tooling is provided by Vite+ (`vp check`, Oxlint + Oxfmt); no ESLint/Prettier config. `vite-plus@0.3.0` bundles `oxlint@1.79.0`/`oxfmt@0.64.0`, so the former latent version gap (`0.2.9` bundled `1.77.0`/`1.73.0`) is now closed — `oxlint` is intentionally unpinned and resolved from the bundle. `@oxlint/plugins@1.79.0` remains pinned in `package.json` because pnpm cannot resolve the custom plugin's import from the bundled copy (see Workflow conventions).
- Documented code-level debt: draft creation is create-then-delete (not atomic); `CreateMailboxBody.settings` is unvalidated and `agentSystemPrompt` flows straight to the AI. Mailbox deletion now performs a full cascade (see `docs/api.md`).

See `docs/architecture.md` for system structure and trust boundary.
