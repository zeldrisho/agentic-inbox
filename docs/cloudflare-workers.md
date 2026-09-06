# Cloudflare Workers development

The Worker lives in `workers/`. A single Worker serves the Hono API, the
`EmailAgent` WebSocket, the `EmailMCP` server, inbound email, and the React
Router SPA fallback, as described in [`architecture.md`](architecture.md).
Verify Cloudflare limits and pricing against current first-party documentation
before increasing mailbox, storage, or AI usage.

Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always
retrieve current documentation before any Workers, R2, Durable Objects, Workers
AI, or Agents SDK task.

## Primary references

- [Workers documentation](https://developers.cloudflare.com/workers/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Durable Objects documentation](https://developers.cloudflare.com/durable-objects/)
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Objects best practices](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [R2 documentation](https://developers.cloudflare.com/r2/)
- [R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Workers AI documentation](https://developers.cloudflare.com/workers-ai/)
- [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
- [Agents SDK documentation](https://developers.cloudflare.com/agents/)
- [Email Routing](https://developers.cloudflare.com/email-routing/) (receiving via `receiveEmail`)
- [Email Service](https://developers.cloudflare.com/email-service/) (sending via the `EMAIL` `send_email` binding)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) (the auth boundary — see [`security-invariants.md`](security-invariants.md))
- [Workers observability and errors](https://developers.cloudflare.com/workers/observability/errors/)

## Expected commands

| Task                   | Command             |
| ---------------------- | ------------------- |
| Local development      | `vp run dev`        |
| Generate binding types | `vp run cf-typegen` |
| Typecheck              | `vp run typecheck`  |
| Production build       | `vp run build`      |
| Build + deploy         | `vp run deploy`     |

`vp run deploy` builds the React Router SPA (`react-router build`) and then runs
`wrangler deploy`. Regenerate types after changing bindings in `wrangler.jsonc`
(`vp run cf-typegen` runs `wrangler types` and writes `worker-configuration.d.ts`).

## Entry and routing

The Worker entry is `workers/app.ts`. It layers, in order:

1. **Cloudflare Access JWT middleware** — validates the
   `cf-access-jwt-assertion` header in production and fails closed when
   `POLICY_AUD` / `TEAM_DOMAIN` are unset. Skipped only when
   `import.meta.env.DEV` (local development).
2. **`/mcp`** — the `EmailMCP` Durable Object server.
3. **`/`** — the Hono API (`workers/index.ts`; keep handlers thin, push logic
   into Durable Objects and `workers/lib/`).
4. **`/agents/*`** — `routeAgentRequest` for the `EmailAgent` WebSocket.
5. **`*`** — React Router SPA fallback.

Inbound email arrives through the `receiveEmail` email handler in
`workers/index.ts`.

## Bindings (`wrangler.jsonc`)

- `nodejs_compat` compatibility flag is enabled; `compatibility_date` is
  `2025-11-28`.
- `observability.enabled` is `true`.
- `vars.EMAIL_ADDRESSES` defaults to `[]`; production also requires
  `POLICY_AUD`, `TEAM_DOMAIN`, and the `DOMAINS` secret
  (`wrangler secret put DOMAINS`, comma-separated Email Routing domains).
- `send_email` binding `EMAIL` with `remote: true` — sending only works against
  a real Cloudflare deployment, not local dev.
- `r2_buckets` binding `BUCKET` (`agentic-inbox`) — per-mailbox blobs and
  `mailboxes/<id>.json` markers.
- `ai` binding `AI` with `remote: true` — Workers AI inference for the agent.
- Durable Objects: `MAILBOX` (`MailboxDO`, per-mailbox SQLite + R2),
  `EMAIL_AGENT` (`EmailAgent`, `AIChatAgent` + 9 email tools),
  `EMAIL_MCP` (`EmailMCP`, MCP tools at `/mcp`).
- Migrations `v1`–`v3` register the three SQLite-backed classes. Add a new
  migration tag when introducing a new SQLite class; never edit applied tags.

There is no D1, KV, Queues, or Vectorize binding in this project. Do not add
one without updating `wrangler.jsonc`, regenerating types, and documenting the
new dependency here.

## Errors

- **Error 1102** (CPU/memory exceeded): check
  [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
  before optimizing or sharding work.
- **All errors**: [Workers observability and errors](https://developers.cloudflare.com/workers/observability/errors/).
