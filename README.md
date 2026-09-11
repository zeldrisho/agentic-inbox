<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
  <p><em>Community fork — see <code>docs/</code> for development, architecture, security, and API docs.</em></p>
</div>

Agentic Inbox lets you send, receive, and manage email on your own Cloudflare account via [Email Routing](https://developers.cloudflare.com/email-routing/) — each mailbox isolated in a [Durable Object](https://developers.cloudflare.com/durable-objects/) (SQLite + [R2](https://developers.cloudflare.com/r2/)) with an AI agent built on the [Agents SDK](https://developers.cloudflare.com/agents/) + [Workers AI](https://developers.cloudflare.com/workers-ai/).

![Agentic Inbox screenshot](./docs/assets/demo.png)

> Blog post: [Email for Agents](https://blog.cloudflare.com/email-for-agents/)

## Setup

> Deploy button alone is not enough — complete steps 2–5 after. Full guide with screenshots: https://github.com/cloudflare/agentic-inbox/issues/4#issuecomment-4269118513

1. **Deploy** — [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agentic-inbox) — provisions R2, Durable Objects, and Workers AI. Set `DOMAINS` (comma-separated, e.g. `example.com`) as a **Worker secret** (`npx wrangler secret put DOMAINS`); never in `wrangler.jsonc`.
2. **Cloudflare Access** — Enable [one-click Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) under Worker Settings > Domains & Routes, then set `POLICY_AUD` + `TEAM_DOMAIN` secrets from the modal.
3. **Email Routing** — Create a catch-all rule forwarding to this Worker (Dashboard > Domain > Email Routing).
4. **Email Service** — Enable the `send_email` binding to send outbound — see [Email Service docs](https://developers.cloudflare.com/email-routing/email-workers/send-email-workers/).
5. **Create mailbox** — Open the deployed app and create e.g. `hello@example.com`.

## Features

- **Full email client** — Rich-text compose, reply/forward threading, folders, search, attachments via Email Routing
- **Per-mailbox isolation** — Durable Object + SQLite + R2 per mailbox
- **AI agent** — Side panel with 9 email tools; streaming markdown, tool visibility, persistent history
- **Auto-draft (opt-in, off by default)** — `agentAutoDraft` drafts replies on inbound mail; always requires confirmation (see `docs/architecture.md#agent-behavior`)

## Stack

React 19 / React Router v7 / Tailwind / Zustand / TipTap / `@cloudflare/kumo` · Hono / Workers / Durable Objects (SQLite) / R2 / Email Routing · Agents SDK (`AIChatAgent`) / AI SDK v6 / Workers AI (`@cf/moonshotai/kimi-k2.5`) · Cloudflare Access JWT

## Local development

```bash
vp install
vp run dev   # http://localhost:5173 — Access skipped in dev
vp run deploy
```

Prerequisites: Cloudflare account + domain, [Email Routing](https://developers.cloudflare.com/email-routing/), [Email Service](https://developers.cloudflare.com/email-service/), [Workers AI](https://developers.cloudflare.com/workers-ai/), [Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) (prod only). Details: `docs/development.md` + `wrangler.jsonc` bindings.

Additional setup: `npx wrangler secret put DOMAINS` and `wrangler r2 bucket create agentic-inbox` (once).

> Auth model: any user passing the shared Access policy can access all mailboxes (including MCP at `/mcp` via `mailboxId`). No per-mailbox auth — Access is the sole boundary. See `docs/architecture.md` (Trust boundary).

## Architecture

> Details: `docs/architecture.md`.

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  (SQLite + R2)  │
│  Agent Panel │     │                  │     └─────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌─────────────────┐
       │             │                  │     │  EmailAgent DO  │
       │ WebSocket   │                  │     │  (AIChatAgent)  │
       └─────────────┤                  │     │  9 email tools  │
                     │                  │────>│  Workers AI     │
                     └──────────────────┘     └─────────────────┘
```

## Documentation

| Topic                     | File                                           |
| ------------------------- | ---------------------------------------------- |
| Development               | [`docs/development.md`](docs/development.md)   |
| Architecture and security | [`docs/architecture.md`](docs/architecture.md) |
| REST API                  | [`docs/api.md`](docs/api.md)                   |
| Testing                   | [`docs/testing.md`](docs/testing.md)           |
| Remaining work            | [`docs/plan.md`](docs/plan.md)                 |

## License

Apache 2.0 — see [LICENSE](LICENSE).
