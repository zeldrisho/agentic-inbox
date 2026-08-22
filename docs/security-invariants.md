# Security Invariants

This document records the security model of agentic-inbox and the boundaries that must not be weakened. It is written for contributors and reviewers; it is **not** a vulnerability report.

## Trust boundary

**Cloudflare Access is the single authentication and authorization boundary.**

- `workers/app.ts` installs a global middleware that, in production, verifies the `cf-access-jwt-assertion` header against `POLICY_AUD` / `TEAM_DOMAIN` using `jose` + the Access JWKS.
- The worker **fails closed** in production: if `POLICY_AUD` or `TEAM_DOMAIN` are unset, every request is rejected with `500`. Missing or invalid tokens return `403`.
- In development (`import.meta.env.DEV`) the check is skipped so the app runs open on `localhost`.

> **Invariant:** Do not introduce a second, weaker auth path (e.g. a mailbox password or API token) that would let a request bypass the shared Access policy. Any per-mailbox access control must be layered _on top of_ Access, not instead of it.

## No per-mailbox authorization

By design, any user who passes the shared Access policy can read, search, draft, and send from **every** mailbox, and the MCP server at `/mcp` can operate on any mailbox by passing a `mailboxId` parameter. This is intentional shared-tenant behavior for a trusted team.

> **Invariant:** `mailboxId` is user-supplied (API path param and MCP argument). Code must treat it as untrusted input for _existence_ checks, but must not treat passing the Access policy as insufficient for cross-mailbox access.

## CORS

The `/api/*` CORS policy allows same-origin requests (no `Origin` header) and `localhost`/`127.0.0.1` in development only. All other cross-origin origins are blocked (the handler returns `undefined`, omitting `Access-Control-Allow-Origin`).

> **Invariant:** Do not broaden CORS to `*`, and do not add arbitrary-origin reflection. The SPA and API are same-origin.

## Mailbox existence checks

`requireMailbox` (`workers/lib/mailbox.ts`) and the MCP `verifyMailbox` helper only confirm that `mailboxes/<id>.json` exists in R2 before operating — they do not authorize the caller.

## AI safety

- **Prompt injection scanning** (`isPromptInjection`, `workers/lib/ai.ts`): every inbound email body is scanned before auto-drafting. The scanner **fails closed** — if the model call errors or is inconclusive, the email is treated as a potential injection and auto-draft is skipped (the email is still stored).
- **Draft verification** (`verifyDraft`): strips AI/system artifacts from outgoing drafts, with a safety cutoff (falls back to the original if the model removes more than 50% of content). Note: the current catch path can return an empty body on AI failure — callers should guard against saving blank drafts.
- The agent never sends without explicit human confirmation.

## Secrets & configuration

- Production secrets `POLICY_AUD` and `TEAM_DOMAIN` are provided via `wrangler secret put` (see `.dev.vars.example`). They must never be committed.
- `DOMAINS` and `EMAIL_ADDRESSES` are non-secret vars in `wrangler.jsonc`. `EMAIL_ADDRESSES` is an optional allowlist restricting mailbox creation and inbound receipt.
- No hardcoded credentials or signing keys exist in the source.

## Output handling

- Attachment filenames are sanitized before use in `Content-Disposition` (control chars and quotes replaced).
- Email bodies may contain HTML; rendering in the UI uses sanitized output (see `app/components/EmailIframe.tsx` and DOMPurify on the client). New HTML rendering paths must sanitize untrusted email content.

## Known risks / accepted limitations

- Unvalidated `CreateMailboxBody.settings` flows into `agentSystemPrompt` and is sent straight to the AI. Treat as trusted-tenant input only; do not expose it to untrusted actors.
- `DELETE /mailboxes/:id` deletes the settings blob but **not** the Durable Object data or R2 attachment blobs (TODO in `workers/index.ts`). Orphaned data persists until a full cleanup is implemented.
- Draft create-then-delete is not atomic (`workers/index.ts` comment).
- Several Durable Object methods are currently reached via `(stub as any)` casts because they are not yet on the typed interface; tighten these as the typed API grows.
- Mailbox deletion (`DELETE /mailboxes/:id`) now cascades: it wipes the mailbox DO's emails/attachments, deletes R2 attachment blobs in one batched call, best-effort destroys the per-mailbox agent DO (chat history) via `ctx.waitUntil`, then removes the settings blob. If the agent destroy fails, only chat history is orphaned — email data is fully cleaned.

## Review guidance

When changing auth, CORS, the Access middleware, the AI scanner, or the MCP surface, re-read this file. Preserve fail-closed behavior and the single Access trust boundary. For a structured review of a specific change, run a security review against the diff.
