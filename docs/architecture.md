# Architecture

Agentic Inbox is a full email client plus an AI email agent, deployed as a single Cloudflare Worker. The Hono API and the React Router SPA are served from the same origin; per-mailbox state lives in isolated Durable Objects.

## High-level design

```text
┌──────────────┐     ┌──────────────────┐     ┌───────────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO (per addr) │
│  React SPA   │     │  (API + SSR)     │     │  SQLite + R2 blobs    │
│  Agent Panel │     │                  │     └───────────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌───────────────────────┐
       │             │                  │     │  EmailAgent DO         │
       │ WebSocket   │                  │     │  AIChatAgent + 9 tools│
       └─────────────┤                  │────>│  Workers AI            │
                     │                  │     └───────────────────────┘
   Email Routing ───>│  email handler   │     ┌───────────────────────┐
                     │  receiveEmail()  │────>│  EmailMCP DO (/mcp)    │
                     └──────────────────┘     │  MCP tools for AI apps │
                                              └───────────────────────┘
```

The Worker entry (`workers/app.ts`) layers, in order:

1. **Cloudflare Access JWT middleware** — validates `cf-access-jwt-assertion` in production, fails closed if misconfigured.
2. **`/mcp`** — Model Context Protocol server (`EmailMCP`).
3. **`/`** — the Hono API (`workers/index.ts`).
4. **`/agents/*`** — `routeAgentRequest` for the `EmailAgent` WebSocket.
5. **`*`** — React Router SPA fallback.

## Components

### Worker API (`workers/index.ts`)

A Hono app exposing `/api/v1/...`:

- Mailbox CRUD (`/mailboxes`)
- Email list/get/create/draft/move/delete, threads, folders, search
- Attachment download
- Compose helpers: reply/forward (`workers/routes/reply-forward.ts`)
- CORS middleware: same-origin only, `localhost`/`127.0.0.1` allowed in development, all other cross-origin requests blocked.

`POST /mailboxes/:id/emails` validates the sender against the mailbox, enforces a send rate limit, stores attachments in R2, writes the message to the `MailboxDO`, and **defers** outbound delivery via `sendEmail` (`workers/email-sender.ts`).

### MailboxDO (`workers/durableObject`)

One Durable Object instance per email address (`idFromName(email)`). Holds:

- A SQLite database (SQL in `workers/db/schema.ts` and `workers/durableObject/migrations.ts`) for emails, threads, folders, and drafts.
- R2-backed attachments (`attachments/<emailId>/<attachmentId>/<filename>`), referenced from SQLite.
- Mailbox settings in R2 (`mailboxes/<email>.json`).

The `requireMailbox` middleware (`workers/lib/mailbox.ts`) verifies the mailbox exists and attaches the DO stub to the request context.

### EmailAgent (`workers/agent`)

An `AIChatAgent` with 9 email tools (defined in `workers/lib/tools.ts`): reading, searching, drafting, and sending. On new inbound email, `receiveEmail` triggers `onNewEmail` **only when `agentAutoDraft === true`** (default off — see `docs/agent-on-demand.md`; `workers/agent/index.ts:handleNewEmail` returns `skipped/auto_draft_disabled` and `workers/index.ts:receiveEmail` gates `waitUntil(agent.fetch(/onNewEmail))` behind the R2 setting). When enabled, it scans for **prompt injection** (`isPromptInjection` in `workers/lib/ai.ts`, fail-closed: errors/inconclusive skip auto-draft but the email is still stored) and, if clean, auto-generates a draft — always requiring explicit human confirmation before send. Drafts are cleaned by `verifyDraft` to strip AI/system artifacts (50% length-drop safety cutoff; on AI failure it can return an empty body, so callers must guard against saving blank drafts).

### EmailMCP (`workers/mcp`)

Exposes the same tools over MCP at `/mcp` so external AI tools (Claude Code, Cursor, etc.) can operate on mailboxes by passing a `mailboxId` parameter.

### Inbound email (`workers/app.ts` → `receiveEmail`)

1. Stream and size-limit the raw message (25 MB cap).
2. Parse with `postal-mime`.
3. Resolve the target mailbox (respecting `EMAIL_ADDRESSES` allowlist if set); ignore mail with no matching/known mailbox.
4. Store attachments to R2, write the email to `MailboxDO`, compute threading.
5. `waitUntil` a fire-and-forget call to `EmailAgent.onNewEmail` — gated on `agentAutoDraft === true` (default off); otherwise the step is skipped with `0` AI calls.

## Data model & storage

- **SQLite (in MailboxDO):** emails, threads, folders, drafts, search indexes.
- **R2:** mailbox settings (`mailboxes/*.json`) and attachment blobs.
- **Outbound:** `send_email` binding (`EMAIL`), deferred via `executionCtx.waitUntil`.

## Trust boundary

Cloudflare Access is the **single** authentication/authorization boundary (`workers/app.ts` validates `cf-access-jwt-assertion` against `POLICY_AUD` / `TEAM_DOMAIN`, failing closed with `500` if unset and `403` on missing/invalid tokens; skipped only on `localhost` dev). Once a user passes the shared policy they can reach every mailbox and the MCP server. There is no per-mailbox authorization — `mailboxId` (API path param, MCP argument) is untrusted input for existence checks only (`requireMailbox` confirms `mailboxes/<id>.json` exists in R2, nothing more). Do not add a second, weaker auth path that bypasses the shared Access policy. CORS stays same-origin only (`localhost`/`127.0.0.1` allowed in dev, all other cross-origin origins blocked) — never `*` or arbitrary-origin reflection.

## Trade-offs

- **Per-mailbox Durable Objects** give strong isolation and SQLite query performance, at the cost of cross-mailbox operations (search/list across mailboxes) requiring enumeration.
- **Deferred send + auto-draft** keep the request path fast; delivery and drafting happen asynchronously, so transient failures are logged rather than blocking the user.
- **AI draft verification** favors false negatives (keep content) over false positives (strip real content), with a 50% length drop safety cutoff.
- **Untrusted output is sanitized:** attachment filenames are sanitized before `Content-Disposition`, and email HTML renders only through sanitized paths (`app/components/EmailIframe.tsx` + DOMPurify) — new HTML rendering paths must sanitize too.

## References

- Workers AI models catalog: <https://developers.cloudflare.com/workers-ai/models/index.md>
- Workers AI docs index (llms.txt): <https://developers.cloudflare.com/workers-ai/llms.txt>
- Kumo UI docs index (llms.txt): <https://kumo-ui.com/llms.txt>
- Model picker API: `GET /api/v1/models` (proxies catalog with 24h R2 cache + 10s `caches.default`, `?refresh=1` bypasses cache) — switch is in chat sidebar next to send (instant session change), not Settings
- Autoroute: Workers AI client fallback via `workers-ai-provider` `fallback: { mode: "client" }` — no AI Gateway.
