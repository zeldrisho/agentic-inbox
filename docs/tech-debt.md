# Tech-Debt Audit — 2026

> Extracted from `docs/plan.md`. Full audit findings, scoring, and the record of
> what was already fixed. Remaining work lives in `docs/plan.md`.

Scoring: priority = (impact + risk) × (6 − effort), each 1–5 (lower effort = higher priority).

## Resolved

### P1 — typed DO RPC, P2 — branch coverage, maintenance tsc errors (2026)

Implemented from `docs/plan.md`:

- **Typed DO RPC boundary.** New `workers/lib/mailbox-rpc.ts`: a narrow
  `MailboxRpc` interface listing only the methods callers use, with serialized
  shapes (`EmailFull`, `EmailListItem`) instead of raw Drizzle rows; a single
  `asMailboxRpc()` assertion replaces every `stub as any`; `requireMailbox`
  and `getMailboxStub` hand out `MailboxRpc` directly; `workers/index.ts`'s
  ad-hoc `ExtendedMailboxStub`/`asExtended` removed. A compile-time guard
  (`_MailboxDOImplementsRpc`) in the DO fails the build when a `MailboxRpc`
  member is renamed or its parameters drift.
- **`AIChatAgent<any>`** → `AIChatAgent<Env>` (workers/types Env extends
  `Cloudflare.Env`, satisfying the constraint); `onFinish: any` →
  `StreamTextOnFinishCallback<ToolSet>` from `ai`.
- **Branch coverage.** Added error-path suites: reply/forward recipient-shape
  branches, Zod→400 via `app.onError`, search filter parsing, inbound email
  with attachments/cc/bcc (`tests/integration/error-paths.test.ts`), and hook
  tests for `useComposeForm` send/save-draft failure paths
  (`tests/app/hooks/useComposeForm.test.tsx`). Gates raised in
  `vite.config.ts` (global branches ≥75% plus per-file floors) and documented
  in `docs/testing.md`.
- **Dead code found by coverage work:** the catch-all "mirror" block in
  `receiveEmail` was unreachable — `routedByCatchAll` is only set when
  `effectiveMailboxId` has already become `adminMailboxId`, so its own guard
  (`adminMailboxId !== effectiveMailboxId`) could never hold, and primary
  delivery already lands in the admin DO. Removed; catch-all mail is re-filed
  into newly created mailboxes by `migrateCatchAllMail`.
- **Pre-existing `tests/` tsc errors (~49)** fixed: global-vs-workers `Env`
  mismatches, `DurableObjectStub<unknown>` brand violations, Kumo/React type
  mismatches in component tests, union narrowing in tool-result assertions.
  `vp exec tsc -b` is clean.

### Browser E2E ported to Playwright (P4)

`tests/e2e/send-draft.spec.ts` drives send→draft and agent model-switch flows
in real Chromium against `vp run dev` (`playwright.config.ts`,
`vp run test:e2e`). The jsdom file stays as the CI-fast fallback; the
Selector quirks are recorded in `docs/testing.md`. CI runs the suite as a
separate non-blocking job (`.github/workflows/ci.yml`, `continue-on-error`)
until it has soaked; flip it to required afterwards.

### AgentPanel split (P5)

649-line hotspot split into `app/components/agent/`: `tool-parts.ts`
(centralized dynamic-tool typing via AI SDK guards — no more `as any`),
`ToolCallBadge.tsx`, and `MessageBubble.tsx`. `AgentPanel.tsx` keeps only chat
state, model switching, and panel wiring.

### Mailbox deletion cascade (was P28 — highest priority)

`DELETE /api/v1/mailboxes/:id` previously deleted only the R2 settings blob,
orphaning all DO email data and attachment blobs (privacy/data-retention gap).
Implemented as a strict-order cascade in `workers/index.ts`:

1. `MailboxDO.destroy()` (`workers/durableObject/index.ts`) collects every
   attachment's R2 key, then wipes attachments, emails, and custom folders.
   Seeded default folders are preserved so the same address can be re-created
   cleanly (migrations only run once per DO).
2. Attachment blobs deleted from R2 in batched calls (`delete()` accepts up
   to 1000 keys; large mailboxes are split into multiple requests).
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
- Tests updated for the cascade: `MailboxDO.destroy()` unit tests
  (`tests/integration/mailbox.test.ts`), DELETE-cascade API test plus an
  R2-batch-aware bucket mock (`tests/integration/api.test.ts`), and a
  `registerTool`-aware McpServer mock (`tests/integration/mcp.test.ts`).

## Remaining items (details)

Full table in `docs/plan.md`; the only open item:

- **Dependency majors (P3)** — pre-1.0 Cloudflare agent SDKs accumulate fixes
  without backports; the longer the gap, the harder the jump. Order:
  `agents` + `@cloudflare/ai-chat` first (they co-move), then `zod`, then
  `react-router`. One major per quarter.

## Explicitly out of scope

- Third-party UI internals (Kumo, Tiptap) beyond provider-level renders.
- `worker-configuration.d.ts` and generated types.
- Per-mailbox authorization tests — Cloudflare Access is the single auth
  boundary by design (see `docs/security-invariants.md`).
