# Project Status and Plans

The main implementation work is complete. This document records the current
browser-test coverage gaps and the maintenance approach for future work.

## Browser E2E coverage

The Playwright suite is in `tests/e2e/send-draft.spec.ts` and runs as a required
CI job. It is intentionally kept to six tests or fewer and under three minutes.
The current smoke coverage includes saving a draft, sending an email, and
switching the agent model.

Reply and forward flows are not yet covered against a seeded inbound email.
Future coverage for these flows should include thread preservation and
sanitized HTML rendering. Mailbox deletion also needs browser coverage that
verifies its destructive cascade.

Folder-move and search flows are lower-priority additions. They should be added
when a regression or other risk justifies expanding the smoke suite.

## Dependency maintenance

Patch and minor dependency updates can be applied as needed. Major upgrades
should be staged separately and verified together with peer dependencies,
generated types, `vp check`, tests, and the production build.
