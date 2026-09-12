# Architecture

Agentic Inbox is a React email client and AI agent deployed as one Cloudflare
Worker. Hono API and the SPA share an origin; each mailbox has isolated state
in a Durable Object.

```text
Browser / SPA ──> Worker ──> MailboxDO (SQLite + R2)
       │             ├── /agents/* ──> EmailAgent DO (AI tools)
       │             └── /mcp ────────> EmailMCP DO
Email Routing ──> receiveEmail ───────> MailboxDO
```

## Request and data flow

`workers/app.ts` applies Access middleware, then routes `/mcp`, the Hono API,
`/agents/*`, and finally the SPA fallback. Inbound mail is parsed and stored by
`receiveEmail`; attachments live in R2 and email, thread, folder, and draft
records live in the mailbox's SQLite database. Outbound delivery uses the
`EMAIL` binding and is deferred with `waitUntil`.

`MailboxDO` is addressed by email and owns mailbox data. `EmailAgent` is an
`AIChatAgent` with the email tools in `workers/lib/tools.ts`. `EmailMCP`
exposes the same tools to external AI clients. The API also provides mailbox,
email, draft, thread, folder, search, and attachment operations; see
[`api.md`](api.md).

## Trust boundary

Cloudflare Access is the sole authentication and authorization boundary.
Production validates `cf-access-jwt-assertion` against `POLICY_AUD` and
`TEAM_DOMAIN`, failing closed when configuration is missing. Localhost skips
Access for development. A user who passes the shared policy can access every
mailbox and MCP; there is no per-mailbox authorization. `mailboxId` is used
only for existence checks by `requireMailbox`.

Keep CORS same-origin only (with localhost development exceptions). Do not add
an alternate auth path or arbitrary-origin reflection.

## Agent behavior

Auto-draft is opt-in: `agentAutoDraft` defaults off and inbound mail causes no
AI call unless it is explicitly enabled. The inbound handler and agent both
gate this behavior. When enabled, prompt-injection screening and draft
verification remain in the path, and a human must confirm before sending.
Manual drafts use the same verification safeguards.

The agent model is stored per mailbox as `agentModel`: `"autoroute"` or an
explicit `@cf/...` model. `GET /api/v1/models` fetches and caches the current
Workers AI catalog, with a static fallback. The agent uses Workers AI client
fallbacks; there is no AI Gateway binding.

## Storage and trade-offs

- SQLite in `MailboxDO`: emails, threads, folders, drafts, and search indexes.
- R2: mailbox settings and attachment blobs.
- `EMAIL`: deferred outbound delivery.

Per-mailbox Durable Objects provide isolation and local query performance, but
cross-mailbox operations require enumeration. Deferred delivery and drafting
keep requests fast but are asynchronous. Email HTML and attachment filenames
must remain sanitized on every rendering/download path.
