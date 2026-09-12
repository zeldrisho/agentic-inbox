# Remaining Work

The main implementation work is complete. Keep this file for actionable
follow-ups only; historical audits and upgrade narratives belong in git history.

## Browser E2E

The Playwright suite is in `tests/e2e/send-draft.spec.ts` and currently runs as
non-blocking CI coverage while it soaks.

- [x] E2E is blocking in CI; retain the suite as a small smoke-test gate.
- [ ] Add reply/forward coverage against a seeded inbound email, including
      threading and sanitized HTML rendering.
- [ ] Add mailbox-deletion E2E coverage for the destructive cascade.

Keep the suite at six tests or fewer and under three minutes. Lower-priority
folder-move and search flows should be added only if regressions justify them.

## Maintenance

- Apply patch/minor dependency updates as needed.
- Stage major upgrades separately and verify peer dependencies, generated types,
  `vp check`, tests, and build together.
