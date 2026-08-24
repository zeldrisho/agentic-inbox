# Remaining Work

> Conventions and mock recipes for tests: `docs/testing.md`.
> Audit details, scoring, and resolved items: `docs/tech-debt.md`.
> Upgrade implementation details: `docs/upgrade-notes.md`.

No remaining planned tech-debt items. Future dependency majors are staged one per quarter; patch/minor bumps may be applied anytime.

## Browser E2E (Playwright) follow-ups

Suite lives in `tests/e2e/send-draft.spec.ts` (send→draft, send→sent, agent
model-switch). Cold starts are handled by `tests/e2e/global-setup.ts`; budget
rule: keep the suite at ≤6 tests / <3 min runtime. One PR per item so each soaks
in CI before the next lands.

- [ ] **Soak, then flip CI job to required.** With the cold-start warmup and
      hardened waits in place, let 3–5 CI runs go green, then delete
      `continue-on-error: true` from the `e2e` job in
      `.github/workflows/ci.yml` and drop the "flip to required afterwards"
      note in `docs/tech-debt.md`.
- [ ] **Reply / forward e2e.** Drive reply or forward from an open email
      (`email-panel` UI → `POST .../emails/:id/reply|forward`) against a
      seeded inbound email; assert the sent copy lands in Sent with correct
      threading (`in_reply_to`). Also gives real-browser coverage of
      `EmailIframe` HTML rendering, which nothing else covers.
- [ ] **Mailbox deletion cascade e2e.** Create a mailbox, seed mail across
      folders via the API, delete it through the Settings UI, then verify the
      cascade (mail/attachments/custom folders gone) via API. Guards the
      recently shipped destructive path (was P28).
- Lower priority, only if a regression history emerges: folder create +
  move-email via sidebar; search submission (`search-results.tsx`).
  Skip: theme toggle, MCP panel, attachment upload plumbing.

## Commit hygiene

- [ ] Move the pending e2e changes (warmup global-setup, cold-start hardening,
      send→sent test, plan updates) onto their own branch off latest `main`;
      they are unrelated to `chore/dep-majors-stage1`'s theme.
