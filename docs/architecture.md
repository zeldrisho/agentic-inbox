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

An `AIChatAgent` with 9 email tools (defined in `workers/lib/tools.ts`): reading, searching, drafting, and sending. On new inbound email, `receiveEmail` triggers `onNewEmail`, which scans for **prompt injection** (`isPromptInjection` in `workers/lib/ai.ts`) and, if clean, auto-generates a draft — always requiring explicit human confirmation before send. Drafts are cleaned by `verifyDraft` to strip AI/system artifacts.

### EmailMCP (`workers/mcp`)

Exposes the same tools over MCP at `/mcp` so external AI tools (Claude Code, Cursor, etc.) can operate on mailboxes by passing a `mailboxId` parameter.

### Inbound email (`workers/app.ts` → `receiveEmail`)

1. Stream and size-limit the raw message (25 MB cap).
2. Parse with `postal-mime`.
3. Resolve the target mailbox (respecting `EMAIL_ADDRESSES` allowlist if set); ignore mail with no matching/known mailbox.
4. Store attachments to R2, write the email to `MailboxDO`, compute threading.
5. `waitUntil` a fire-and-forget call to `EmailAgent.onNewEmail` to trigger the auto-draft.

## Data model & storage

- **SQLite (in MailboxDO):** emails, threads, folders, drafts, search indexes.
- **R2:** mailbox settings (`mailboxes/*.json`) and attachment blobs.
- **Outbound:** `send_email` binding (`EMAIL`), deferred via `executionCtx.waitUntil`.

## Trust boundary

Cloudflare Access is the **single** authentication/authorization boundary. Once a user passes the shared policy they can reach every mailbox and the MCP server. There is no per-mailbox authorization. See `docs/security-invariants.md`.

## Trade-offs

- **Per-mailbox Durable Objects** give strong isolation and SQLite query performance, at the cost of cross-mailbox operations (search/list across mailboxes) requiring enumeration.
- **Deferred send + auto-draft** keep the request path fast; delivery and drafting happen asynchronously, so transient failures are logged rather than blocking the user.
- **AI draft verification** favors false negatives (keep content) over false positives (strip real content), with a 50% length drop safety cutoff.
