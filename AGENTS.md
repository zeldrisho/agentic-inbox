# Agent Instructions

## Package Manager

- Use **vp**: `vp install`

## Project Layout

| Path                     | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `app/`                   | React Router v7 SPA — UI, routes, components, services, hooks               |
| `workers/`               | Hono API (`index.ts`), Worker entry (`app.ts`), Durable Objects, agent, MCP |
| `workers/durableObject/` | `MailboxDO` — per-mailbox SQLite + R2 storage                               |
| `workers/agent/`         | `EmailAgent` (`AIChatAgent`) — 9 email tools, auto-draft                    |
| `workers/mcp/`           | `EmailMCP` — exposes the same tools over MCP at `/mcp`                      |
| `shared/`                | Types/utilities shared by client and worker (`folders.ts`, `dates.ts`)      |
| `tests/`                 | Vitest suite (`tests/**/*.test.ts`) — mirrors `shared/`, `workers/`, `app/` |
| `wrangler.jsonc`         | Bindings, Durable Object migrations, and secrets                            |

## Commands

| Task                           | Command                  |
| ------------------------------ | ------------------------ |
| Dev server (Vite + Cloudflare) | `vp run dev`             |
| Check (lint/format/typecheck)  | `vp check`               |
| Generate Cloudflare types      | `vp run cf-typegen`      |
| Tests                          | `vp test run --coverage` |
| Production build               | `vp run build`           |
| Build + deploy                 | `vp run deploy`          |

## Key Conventions

- `requireMailbox` (`workers/lib/mailbox.ts`) enforces mailbox _existence_ only. Cloudflare Access is the single auth boundary; there is no per-mailbox authorization.
- `mailboxId` is user-supplied for both API and MCP routes. Do not add per-mailbox auth that bypasses the shared Access policy.
- Keep `workers/index.ts` route handlers thin; push business logic into the Durable Objects and `workers/lib`.
- Before implementation, run `git fetch --prune`, start from the latest `main`, and preserve uncommitted work.
- Delete a completed local branch only when it is merged into its target and its upstream branch is gone.

## External References

| Need                        | File                          |
| --------------------------- | ----------------------------- |
| Overview & setup            | `README.md`                   |
| Development & conventions   | `docs/development.md`         |
| Architecture                | `docs/architecture.md`        |
| Security model & invariants | `docs/security-invariants.md` |
| REST API reference          | `docs/api.md`                 |
| Testing & coverage          | `docs/testing.md`             |
