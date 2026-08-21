# Development

How to build, run, and contribute to this fork of **agentic-inbox**.

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

`tsconfig.json` uses project references (`tsconfig.node.json`, `tsconfig.cloudflare.json`). Run `typecheck` after changing bindings, routes, `shared/` types, or `.worker-configuration.d.ts`.

## Build & deploy

```bash
vp run build     # react-router build
vp run deploy    # build + wrangler deploy
```

Deploying provisions R2, Durable Objects, and Workers AI. After deploying, follow the **After deploying** steps in `README.md` (configure Cloudflare Access, Email Routing, the `send_email` binding, and create a mailbox).

## Project layout

| Path                     | Purpose                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `app/`                   | React Router v7 SPA — `routes/`, `components/`, `services/api.ts`, `lib/`, `hooks/`, `types/`           |
| `workers/index.ts`       | Hono API routes (`/api/v1/...`)                                                                         |
| `workers/app.ts`         | Worker entry — Access middleware, `/mcp`, `/agents/*`, SPA fallback, `email` handler                    |
| `workers/durableObject/` | `MailboxDO` (SQLite + R2) and SQL migrations                                                            |
| `workers/agent/`         | `EmailAgent` — `AIChatAgent` with 9 email tools and auto-draft                                          |
| `workers/mcp/`           | `EmailMCP` — same tools over the Model Context Protocol                                                 |
| `workers/routes/`        | Compose helpers (`reply-forward.ts`)                                                                    |
| `workers/lib/`           | `mailbox.ts` (auth middleware), `tools.ts`, `ai.ts`, `email-helpers.ts`, `schemas.ts`, `attachments.ts` |
| `workers/db/`            | Drizzle schema                                                                                          |
| `shared/`                | `folders.ts`, `dates.ts` — shared client/worker constants & helpers                                     |
| `wrangler.jsonc`         | Bindings, Durable Object migrations (v1–v3), secrets                                                    |
| `.dev.vars.example`      | Template for local `POLICY_AUD` / `TEAM_DOMAIN`                                                         |

## Configuration

- **`wrangler.jsonc`** defines:
  - `vars`: `DOMAINS` (Email Routing domain), `EMAIL_ADDRESSES` (optional allowlist for mailbox creation/receipt)
  - `send_email`: `EMAIL` binding (remote)
  - `r2_buckets`: `BUCKET` (`agentic-inbox`)
  - `ai`: `AI` binding
  - Durable Objects: `MAILBOX` (`MailboxDO`), `EMAIL_AGENT` (`EmailAgent`), `EMAIL_MCP` (`EmailMCP`) with migrations `v1`–`v3`
- **Production secrets** (set via `wrangler secret put` or the deploy modal — see `.dev.vars.example`):
  - `POLICY_AUD` — Cloudflare Access policy audience
  - `TEAM_DOMAIN` — Access team URL or full `/cdn-cgi/access/certs` URL
- The worker **fails closed** in production if `POLICY_AUD` / `TEAM_DOMAIN` are unset (`workers/app.ts`).

## Workflow conventions

- Package manager is **pnpm**, managed by **Vite+ (`vp`)**; the lockfile is `pnpm-lock.yaml`.
- Lint/format is managed by Vite+ (`vp check`, Oxlint + Oxfmt). No automated tests are configured yet. Gate changes with `vp run typecheck` and `vp check`.
- **Toolchain pinning (intentional, do not remove):** `vite` is aliased to `npm:@voidzero-dev/vite-plus-core` and `oxlint`/`@oxlint/plugins` are pinned at `1.79.0` in `package.json` even though `vite-plus` bundles its own copies. `vp` resolves packages with `cwd` **first**, then falls back to its bundled copy, so the top-level pins are what `vp check`/`vp lint` actually run. The `vite` alias is required because `@react-router/dev`, `@cloudflare/vite-plugin`, and `@tailwindcss/vite` import the bare `vite` specifier and peer-depend on it (pnpm's strict isolation would otherwise fail to resolve it). The `oxlint`/`@oxlint/plugins` pins keep the linter in sync with the custom rules in `tools/oxlint/anti-slop/**`, which import `@oxlint/plugins@1.79.0`. Removing them would silently downgrade `vp` to `vite-plus`'s bundled `oxlint@1.77.0`/`@oxlint/plugins@1.73.0` and risk breaking those rules. See _Known gaps_ for the latent version gap.
- Keep `workers/index.ts` route handlers thin; business logic lives in the Durable Objects (`workers/durableObject`, `workers/agent`, `workers/mcp`) and `workers/lib`.
- Shared client/worker code belongs in `shared/`.
- API request bodies are validated with Zod schemas in `workers/lib/schemas.ts` and inline in `workers/index.ts`.

## Known gaps

- No test suite yet — a CI pipeline (GitHub Actions) runs `vp install`, `vp check`, `vp test`, and `vp build`.
- Lint/format tooling is provided by Vite+ (`vp check`, Oxlint + Oxfmt); no ESLint/Prettier config. There is a latent version gap: `oxlint`/`@oxlint/plugins` are pinned at `1.79.0` while `vite-plus@0.2.9` bundles `1.77.0`/`1.73.0`. The top-level pins win (cwd-first resolution), so this is currently harmless, but a future "just use whatever vite-plus bundles" cleanup would silently downgrade linting. Keep the pins unless you also move the custom `tools/oxlint/anti-slop` rules to the bundled version's API.
- Documented code-level debt: `DELETE /mailboxes/:id` does not yet delete Durable Object data or R2 attachment blobs; draft creation is create-then-delete (not atomic); `CreateMailboxBody.settings` is unvalidated and `agentSystemPrompt` flows straight to the AI.

See `docs/architecture.md` for system structure and `docs/security-invariants.md` for the trust boundary and accepted risks.
