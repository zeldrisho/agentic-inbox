# Agentic Inbox — Testing Strategy

> Part A (on-demand agent, sidebar closed by default, Workers AI model switcher + autoroute) is **done** — see `docs/agent-on-demand.md` and `docs/model-switcher.md`.

## 1. Baseline

| Area                             | Status                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0 — 52 unit tests** (6 files) | `tests/shared/{folders,dates}.test.ts`, `tests/app/lib/search-parser.test.ts`, `tests/workers/lib/{ai,email-helpers,schemas}.test.ts` — `vp test` + `vp check` green                                                                                                                             |
| **Covered**                      | folder constants, date formatting, `parseSearchQuery` operators, `validateSender`/`generateMessageId`/`buildQuotedReplyBlock`/`stripHtmlToText`, Zod `SendEmailRequestSchema`, `isPromptInjection`/`verifyDraft` (incl. fail-closed)                                                             |
| **Uncovered**                    | `MailboxDO` SQLite (Drizzle + raw SQL), Hono API (`workers/index.ts` + `requireMailbox`/CORS/Access), `receiveEmail` 25 MB + allowlist + `admin@` mirror + `waitUntil`, `EmailAgent` gated auto-draft + `autoroute` fallback, `EmailMCP` contract, `ComposeEmail`/`EmailIframe` + send→draft E2E |

Runner: Vitest via `vite.config.ts:test` only (no `vitest.config.ts`). `include: ["tests/**/*.test.{ts,tsx}"]`, `globals: true`, `environment: "node"` + `environmentMatchGlobs` for `tests/components/**` + `tests/e2e/**` → `jsdom`. Tests at repo root mirror `shared/workers/app`. `**/*.test.ts` excluded from strict anti-slop lint.

Stack: React Router v7 + Hono on Cloudflare Workers (`MailboxDO` SQLite+R2, `EmailAgent` AIChatAgent 9 tools, `EmailMCP` at `/mcp`, Workers AI, Cloudflare Access single auth boundary). `pnpm` via `vp`.

## 2. Testing Pyramid

| Layer                  | Volume       | Speed      | Tooling                                                |
| ---------------------- | ------------ | ---------- | ------------------------------------------------------ |
| **Unit** — many/fast   | 80% of tests | <100 ms    | Vitest pool workers, `node` env                        |
| **Integration** — some | 15%          | 200-500 ms | Vitest, mocked R2/DO stubs, Hono `app.request()`       |
| **E2E** — few/slow     | 5%           | seconds    | `jsdom` + RTL + MSW (components), Playwright (browser) |

Fast feedback on units; integration guards contracts (Hono ↔ DO ↔ R2/AI); E2E only for critical UI flows.

## 3. Strategy by Component Type

| Component                                                                                                           | Test type              | Scope                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| **API endpoints** (`workers/index.ts`, `workers/routes/*`, `requireMailbox`)                                        | Integration            | `app.request()` + mocked `Env` (R2 `BUCKET`, `MAILBOX` stub, `AI.run`), assert status codes + `waitUntil` |
| **Data pipelines** (`MailboxDO` — SQLite, `searchEmails`, `checkSendRateLimit`, `findThreadBySubject`, `moveEmail`) | Integration (DO unit)  | Mock `DurableObjectState.storage.sql`/`drizzle`, param-escaping checks, pagination/sort validation        |
| **Inbound** (`receiveEmail`)                                                                                        | Integration            | `postal-mime` parsing, 25 MB cap, `EMAIL_ADDRESSES` allowlist, `admin@` mirror, `agentAutoDraft` matrix   |
| **Frontend** (`ComposeEmail`, `EmailIframe`, `useUIStore`, `AgentPanel`)                                            | Unit (jsdom+RTL) + E2E | Render + interaction, `localStorage` `isAgentPanelOpen: false` default, `DOMPurify` sanitization          |
| **Infra** (`workers/app.ts` Access, `EmailAgent`, `EmailMCP`)                                                       | Integration            | Fail-closed `POLICY_AUD`/`TEAM_DOMAIN` (500 without, 403 bad JWT), gated `onNewEmail`, MCP tool contract  |

## 4. What to Cover / Skip

**Cover** — business-critical paths, error handling, edge cases, security boundaries, data integrity:

- Auth flows (Access JWT valid/missing/expired, fail-closed without `POLICY_AUD`/`TEAM_DOMAIN`)
- Rate-limit/boundary (20/hr, 100/day per mailbox → 429), 25 MB `rawSize` + `stream exceeds declared size`, `postal-mime` empty `To`, `EMAIL_ADDRESSES` allowlist, `admin@`/`catchall@` fallback + mirror suppression
- Data integrity (pagination `limit` 1..100 caps, `sortColumn` allowlist, `searchEmails`/`countSearchResults` LIKE param escaping, `moveEmail`/`deleteFolder` `is_deletable`, `findThreadBySubject` prefix normalization + participant check, `createEmail` sent→read)
- Security (CORS `localhost` allow / `evil.com` block, attachment `Content-Disposition` control-char sanitization, `isPromptInjection` fail-closed, `verifyDraft` 50% cutoff + blank-save guard)

**Skip** — trivial getters, framework code (`react-router`/`hono` internals), generated types (`worker-configuration.d.ts`), third-party UI (Kumo, Tiptap) except via integration.

## 5. Coverage Targets

- **80% overall** — `vp test run --coverage` (v8, `include: ['app/**','workers/**','shared/**']`)
- **90% security/AI/rate-limit** — `workers/lib/ai.ts`, `workers/index.ts` send path, `workers/durableObject/index.ts:checkSendRateLimit`
- Track per-PR; fail CI if under threshold.

## 6. Gaps in Existing Coverage

1. Zero DO/API integration — pagination, `checkSendRateLimit`, `findThreadBySubject`, `searchEmails` escaping, `moveEmail` not exercised against real `MailboxDO`.
2. Inbound unverified — 25 MB cap, `postal-mime` parsing, allowlist, `admin@` mirror + `waitUntil` suppression, `agentAutoDraft` matrix.
3. No Hono/CORS/Access suite — `workers/app.ts` fail-closed, `workers/index.ts` status codes (400/403/409/429), CORS `evil.com` block.
4. `verifyDraft` blank-save hole — `ai.ts` catch returns `""`; callers must guard or blank draft saved (see `docs/security-invariants.md`).
5. `(stub as any)` drift — `workers/lib/tools.ts` (3×), `workers/lib/email-helpers.ts`, `workers/routes/reply-forward.ts` (2×), `workers/durableObject/index.ts` (`row as any`) bypass typed helper.
6. Frontend/E2E absent — `ComposeEmail`/`EmailIframe`, `useUIStore` `isAgentPanelOpen: false` default, send→draft + instant model switch in chat.

## 7. Remaining Work

| Priority                                 | File                                             | Focus                                                                                                                                                                                                                                                                                                                                      | Why                                                  |
| ---------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **P1 — DO + inbound** (week 2)           | `tests/integration/mailbox.test.ts`              | Pagination (`limit` 1..100, `offset=(page-1)*limit`), sort-injection allowlist, `checkSendRateLimit` 20/hr + 100/day, `searchEmails`/`countSearchResults` param escaping, `moveEmail`/`deleteFolder`                                                                                                                                       | Closes gap 1                                         |
|                                          | `tests/integration/receiveEmail.test.ts`         | `rawSize` 25 MB + `stream exceeds declared size`, `postal-mime` empty `To`, allowlist include vs ignore, `admin@` mirror (explicit `admin@/catchall@` vs fallback-to-first-mailbox no-mirror) × `agentAutoDraft` true/false (0 vs 1 `waitUntil` + `agentStub.fetch`)                                                                       | Closes gap 2 + 3 (mirror suppression)                |
| **P2 — API + MCP** (week 3)              | `tests/integration/api.test.ts`                  | `POST /mailboxes` 403 allowlist / 409 exists / 201, `POST /emails` 400 sender-mismatch + Zod + 429 rate-limit / 202, `GET /attachments/:id` sanitized `filename` + 404 + missing blob 404, `requireMailbox` 404, CORS (`Origin` absent/ `localhost:5173` / `evil.com`), `GET /api/v1/models` R2 cache hit + `?refresh=1` bypass + fallback | Closes gap 3 + 6 (status codes)                      |
|                                          | `tests/integration/mcp.test.ts`                  | `list_mailboxes`, `get_email` missing → error, `toolSendReply` `Original email not found` / `Failed to send`, `move_email` bad folder, `update_draft` missing, `search_emails`/`draft_reply`/`send_email`                                                                                                                                  | Closes gap 1 (MCP contract) + 5 (helper vs `as any`) |
| **P3 — Agent + frontend + E2E** (week 4) | `tests/integration/agent.test.ts`                | Gated `handleNewEmail`: `agentAutoDraft:false → {skipped}` (0 `AI.run`), `isPromptInjection:true → block`, `getAgentModel()` default vs per-mailbox vs `autoroute` → `DEFAULT_AGENT_MODEL` + `AUTOROUTE_FALLBACKS` client fallback, inline `result.text` → `verifyDraft` blank→skip / non-blank→`createEmail` (`Folders.DRAFT`)            | Closes gap 2 + 4                                     |
|                                          | `tests/components/compose.test.tsx` (jsdom, RTL) | `useUIStore` `isAgentPanelOpen: false` default, `toggleAgentPanel` persistence, `splitEmailList`/`escapeHtml`/`textToHtml`/`stripHtmlToText` (`<script>`/`<style>` strip), draft body `trim().length>20` guard                                                                                                                             | Closes gap 6 (frontend)                              |
|                                          | `tests/e2e/send-draft.test.ts` (jsdom)           | `localStorage` `agentPanelOpen:false` default, `POST /drafts` → `GET /emails?folder=draft`, instant model switch `GET /mailboxes/:id` → `PUT agentModel` → re-`GET` (no reload)                                                                                                                                                            | Closes gap 6 (E2E)                                   |

## 8. Example Test Cases

**isPromptInjection — fail-closed (workers/lib/ai.ts:50)**

```ts
it("fail-closed: returns true when AI throws", async () => {
  const ai = { run: vi.fn().mockRejectedValue(new Error("AI timeout")) } as unknown as Ai;
  expect(await isPromptInjection(ai, "<p>Long enough body to trigger scan for injection</p>")).toBe(
    true,
  );
});
```

**Rate-limit 429 (workers/index.ts:261 + durableObject:checkSendRateLimit)**

```ts
it("429 when hourly limit exceeded", async () => {
  const stub = mockMailboxStub({
    checkSendRateLimit: vi.fn(
      async () => "Rate limit exceeded: max 20 emails per hour per mailbox",
    ),
  });
  const env = mockEnv(bucket, stub); // bucket has mailboxes/alice@example.com.json
  const { res } = await requestApp(env, "POST", "/api/v1/mailboxes/alice@example.com/emails", {
    to: "b@ex.com",
    from: "alice@example.com",
    subject: "hi",
    html: "<p>hi</p>",
  });
  expect(res.status).toBe(429);
});
```

**receiveEmail mirror suppression (workers/index.ts:690)**

```ts
it("does not trigger agent for mirrored copy", async () => {
  bucket._store.set("mailboxes/admin@example.com.json", JSON.stringify({ agentAutoDraft: true }));
  const raw = buildRawEmail("From: s@ex.com\r\nTo: unknown@example.com\r\nSubject: hi", "hello");
  await receiveEmail({ raw: stream(raw), rawSize: raw.length }, env, {
    waitUntil: vi.fn(),
  } as unknown as ExecutionContext);
  expect(adminStub.createEmail).toHaveBeenCalled(); // primary to admin
  expect(fetchMock).not.toHaveBeenCalled(); // mirror suppressed (isExplicitAdminMailbox=false when fallback)
});
```

## 9. Tooling / CI

- **Guide:** `https://viteplus.dev/guide/test.md` — config only in `vite.config.ts:test` (no `vitest.config.ts`).
- **Commands:** `vp install` / `vp test` (single run, Vitest built-in) / `vp test watch` / `vp test run --coverage` (v8, `include: ['app/**','workers/**','shared/**']`). Use `vp run test` only inside `package.json#scripts`.
- **Env:** `environment: "node"` default; `environmentMatchGlobs: [["tests/components/**","jsdom"],["tests/e2e/**","jsdom"]]`. `**/*.test.ts` excluded from Oxlint anti-slop (tests need `vi.mock`/`as unknown as`/`any` which prod code forbids).
- **CI:** `.github/workflows/ci.yml` runs `vp check → vp test → vp run build` on `setup-vp@v1.17.0` (Node 24). Add coverage gate `vp test run --coverage` (fail <80%) after P3.

## 10. Definition of Done

- `vp test` **>120 tests** (current 148), **≥80%** coverage (≥90% `workers/lib/ai.ts` + rate-limit) — `vp test run --coverage` gate in CI.
- No `(stub as any)` without `asExtended()`/`asAnyContent()` typed helper + `// SAFETY:` (see `workers/index.ts:31`).
- `vp check` (fmt + Oxlint `typeAware` + `tsc -b`) and `vp run build` green.

```
AGENTS.md: single | Tests | vp test | row — keep reduced, do not re-expand.
```
