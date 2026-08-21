# Testing Plan — Remaining Work

> The testing strategy (P0–P3 suites, coverage gate) is **implemented** —
> 324 tests green, ≥80% coverage enforced in CI. Conventions and mock recipes:
> see `docs/testing.md`.

## Remaining work

| Priority             | Item                                                   | Detail                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4 — browser E2E     | Port `tests/e2e/send-draft.test.ts` to real Playwright | Drive send→draft and model-switch flows in an actual browser against `vp run dev`; keep the jsdom simulation as CI-fast fallback                                            |
| P5 — branch coverage | Branches at ~65% vs 80% statement gate                 | Biggest gaps: `workers/index.ts` CORS/error branches, `reply-forward.ts` attachment branches, `useComposeForm.ts`. Add error-path tests before raising the threshold config |
| Maintenance          | Keep gates green                                       | `vp check`, `vp test run --coverage`, `vp run build` must pass per PR; new modules under `app/`/`workers/` need tests in the same PR                                        |

## Explicitly out of scope

- Third-party UI internals (Kumo, Tiptap) beyond provider-level renders.
- `worker-configuration.d.ts` and generated types.
- Per-mailbox authorization tests — Cloudflare Access is the single auth
  boundary by design (see `docs/security-invariants.md`).
