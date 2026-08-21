# Plan — Remaining Work

> Part A (on-demand agent, sidebar closed by default, Workers AI model switcher + autoroute) is **done** and moved to split docs. This file keeps only what's left.

Split docs:

- `docs/agent-on-demand.md` — on-demand gating, prompt, sidebar default
- `docs/model-switcher.md` — live catalog, `GET /api/v1/models`, autoroute, instant chat switcher

References:

- Workers AI models catalog: <https://developers.cloudflare.com/workers-ai/models/index.md>
- Workers AI docs index: <https://developers.cloudflare.com/workers-ai/llms.txt>
- Kumo UI docs index: <https://kumo-ui.com/llms.txt>

---

# Part B — Test Improvements (remaining)

> Status: **P0 unit suite done** (6 files, 52 tests in `tests/`). `vp test` + `vp check` green. This section is the only remaining work.

## B1. Baseline

- Runner: `vp test` (Vitest via `vite.config.ts:test`). No `vitest.config.ts`. `include: ["tests/**/*.test.{ts,tsx}"]`, `globals: true`, `environment: "node"`.
- Covered: `shared/folders`+`dates`, `app/lib/search-parser`, `workers/lib/email-helpers|schemas|ai`.
- Uncovered: `MailboxDO` SQLite, Hono API + `requireMailbox`/CORS/Access, `receiveEmail` mirroring, `EmailAgent` gated auto-draft, `EmailMCP`, frontend/E2E.

## B2. Gaps

1. Zero DO/API integration — pagination, `checkSendRateLimit`, `findThreadBySubject`, `searchEmails` escaping, etc.
2. Inbound unverified — 25 MB cap, `postal-mime`, allowlist, `admin@` mirror, `waitUntil` suppression.
3. No Hono/CORS/Access suite — `workers/app.ts` fail-closed, `workers/index.ts` status codes.
4. `verifyDraft` blank-save hole.
5. `(stub as any)` drift.
6. Frontend/E2E absent — `ComposeEmail`, `EmailIframe`, send→draft flow.

## B3. Remaining Work

### P1 — DO + inbound (week 2)

- `tests/integration/mailbox.test.ts` — pagination, sort injection, rate limit, `searchEmails` escaping, `moveEmail`.
- `tests/integration/receiveEmail.test.ts` — size cap, allowlist, `admin@` mirror (now with `agentAutoDraft` matrix true/false).

### P2 — API + MCP contract (week 3)

- `tests/integration/api.test.ts` — `POST /mailboxes` 403/409, `POST /emails` 400/429, `GET /attachments` sanitization, CORS, `requireMailbox` 404, `GET /api/v1/models` cache/refresh.
- `tests/integration/mcp.test.ts` — `list_mailboxes`, `toolSendReply` etc.

### P3 — Agent + frontend + E2E (week 4)

- `tests/integration/agent.test.ts` — gated `onNewEmail` (0 AI calls when `agentAutoDraft` off), `getAgentModel()` + `autoroute` fallback (`400 unknown model` → next leg), inline `result.text` fallback via `verifyDraft`.
- `tests/components/compose.test.tsx`
- `tests/e2e/send-draft.spec.ts` — Playwright, sidebar closed by default (`isAgentPanelOpen: false`) + instant model switch in chat.

## B4. Definition of Done

- `vp test` >120 tests, coverage ≥80% (90% security/AI), no `(stub as any)` without typed helper.

## B5. Tooling

- CI `vp check → vp test → vp build`; add `vp test run --coverage` gate (v8, `include: ['app/**','workers/**','shared/**']`).
- When adding `jsdom`, set per-project `environment: 'jsdom'` for `tests/components/**`.
