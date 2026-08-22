# Remaining Work

> Conventions and mock recipes for tests: `docs/testing.md`.
> Audit details, scoring, and resolved items: `docs/tech-debt.md`.

| Priority             | Item                                                   | Detail                                                                                                                          |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| P1 — typed DO RPC    | Remove `stub as any` casts and `AIChatAgent<any>`      | Define a narrow `MailboxRpc` interface, cast once; type `onFinish`. Renaming a DO method currently compiles silently.           |
| P2 — branch coverage | Branches at ~65% vs 80% statement gate                 | Error-path tests for `workers/index.ts`, `reply-forward.ts`, `useComposeForm.ts` before raising the threshold config.           |
| P3 — dep majors      | Staged major-version upgrades                          | `agents` + `@cloudflare/ai-chat` first, then `zod`, then `react-router`. One major per quarter; patch/minor bumps anytime.      |
| P4 — browser E2E     | Port `tests/e2e/send-draft.test.ts` to real Playwright | Drive send→draft and model-switch flows in a real browser against `vp run dev`; keep jsdom as CI-fast fallback.                 |
| P5 — UI hotspot      | Split `AgentPanel.tsx` (649 lines)                     | Extract tool-part renderer / draft card subcomponents; centralize dynamic-tool part typing. Fold into next agent-UI feature.    |
| Maintenance          | Keep gates green                                       | `vp check`, `vp test run --coverage`, `vp run build` per PR; new modules need tests; clean up pre-existing `tests/` tsc errors. |
