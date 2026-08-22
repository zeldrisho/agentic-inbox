# Tech-Debt Audit — 2026

> Extracted from `docs/plan.md`. Full audit findings, scoring, and the record of
> what was already fixed. Remaining work lives in `docs/plan.md`.

Scoring: priority = (impact + risk) × (6 − effort), each 1–5 (lower effort = higher priority).

## Resolved

### Mailbox deletion cascade (was P28 — highest priority)

`DELETE /api/v1/mailboxes/:id` previously deleted only the R2 settings blob,
orphaning all DO email data and attachment blobs (privacy/data-retention gap).
Implemented as a strict-order cascade in `workers/index.ts`:

1. `MailboxDO.destroy()` (`workers/durableObject/index.ts`) collects every
   attachment's R2 key, then wipes attachments, emails, and custom folders.
   Seeded default folders are preserved so the same address can be re-created
   cleanly (migrations only run once per DO).
2. Attachment blobs deleted from R2 in one batched call (`delete()` accepts up
   to 1000 keys).
3. Best-effort destroy of the per-mailbox agent DO via `ctx.waitUntil`
   (non-fatal; failure orphans only chat history).
4. Settings blob removed last — it is the existence marker.

Verified against the Cloudflare Agents docs + installed SDK: `Agent.destroy()`
drops its tables, deletes alarms and all storage, and aborts the instance;
`AIChatAgent` recreates its schema with `CREATE TABLE IF NOT EXISTS` on next
construction, so recreation is safe.

Also shipped alongside:

- Removed deprecated `@types/dompurify` (dompurify ships its own types).
- Ingest-path logging switched from `console.log` to `console.info` so the
  events are filterable now that `observability.enabled: true`.
- MCP guarded-tool wrapper: `mailboxTool()` in `workers/mcp/index.ts` injects
  the `mailboxId` param and runs the mailbox-existence check before every
  handler, making it impossible for a tool to forget the deny-check.

Implementation notes worth keeping:

- The MCP SDK's `server.tool(name, description, shape, cb)` overload union
  (`paramsSchema | ToolAnnotations`) defeats generic type inference when the
  shape is built from a spread. Use `registerTool(name, { description,
inputSchema: z.object({...}) }, cb)` instead — inference works there.
- `tsc -b` has ~49 pre-existing errors in `tests/` on vanilla main; CI's
  `vp check` doesn't surface them because it excludes test files. Fixing these
  is folded into the maintenance item in `docs/plan.md`.
- Tests updated for the cascade: `MailboxDO.destroy()` unit tests
  (`tests/integration/mailbox.test.ts`), DELETE-cascade API test plus an
  R2-batch-aware bucket mock (`tests/integration/api.test.ts`), and a
  `registerTool`-aware McpServer mock (`tests/integration/mcp.test.ts`).

## Remaining items (details)

Full table in `docs/plan.md`; context per item:

- **Typed DO RPC boundary** — six `stub as any` casts (`tools.ts`,
  `email-helpers.ts`, `reply-forward.ts`) plus `AIChatAgent<any>` /
  `onFinish: any` (`agent/index.ts`). Renaming a DO method compiles silently at
  every call site. Fix: narrow `MailboxRpc` interface listing only the methods
  callers use, cast once to that; type `onFinish` with the AI SDK callback.
- **Branch coverage** (~65% vs 80% statement gate) — error paths are where
  production incidents live; statements can pass while every failure branch is
  untested. Gaps: `workers/index.ts` CORS/error branches,
  `reply-forward.ts` attachment branches, `useComposeForm.ts`.
- **Dependency majors** — pre-1.0 Cloudflare agent SDKs accumulate fixes
  without backports; the longer the gap, the harder the jump. Order:
  `agents` + `@cloudflare/ai-chat` first (they co-move), then `zod`, then
  `react-router`. One major per quarter.
- **Browser E2E** — current `tests/e2e/send-draft.test.ts` simulates
  send→draft in jsdom; real-browser Playwright covers rendering/streaming
  regressions it cannot see.
- **AgentPanel split** — 649 lines mixing chat state, streaming-part
  rendering, four `(part as any)` dynamic-tool casts, and draft handling;
  highest-change file in the app. Fold into the next agent-UI feature.

## Explicitly out of scope

- Third-party UI internals (Kumo, Tiptap) beyond provider-level renders.
- `worker-configuration.d.ts` and generated types.
- Per-mailbox authorization tests — Cloudflare Access is the single auth
  boundary by design (see `docs/security-invariants.md`).
