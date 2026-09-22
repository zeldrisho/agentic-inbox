# Agent Instructions

## Toolchain

- Use Vite+ (`vp`) with the repository's pnpm lockfile: `vp install`.
- Invoke project scripts with `vp run <name>`; built-ins such as `vp dev` are not equivalent.
- Preserve intentional toolchain pins and the `vite` alias; see `docs/development.md` (Repository conventions).

## Commands

| Task                       | Command                                        |
| -------------------------- | ---------------------------------------------- |
| Dev server                 | `vp run dev`                                   |
| Test file                  | `vp test run tests/shared/folders.test.ts`     |
| Check file                 | `vp check app/services/api.ts`                 |
| Generate types + typecheck | `vp run typecheck`                             |
| Browser E2E file           | `vp run test:e2e tests/e2e/send-draft.spec.ts` |

- Replace example file paths with the relevant files; `vp check` typechecking remains project-wide.

- Run `vp run typecheck` after changing bindings, routes, or shared types.
- For full CI verification, follow `.github/workflows/ci.yml`, including type generation before checks.

## Key Conventions

- Keep `workers/index.ts` handlers thin; put business logic in `workers/lib/` and Durable Objects.
- Put client/worker shared code in `packages/shared/` and import it as `shared/*`.
- Cloudflare Access is the sole auth boundary; `requireMailbox` checks existence, not per-mailbox authorization. Preserve the trust boundary in `docs/architecture.md`.
- Keep `DOMAINS`, `POLICY_AUD`, and `TEAM_DOMAIN` as secrets, not values committed in `wrangler.jsonc`.
- Local `EMAIL` and `AI` bindings are remote and can send real email or consume Workers AI; use test recipients.
- Never edit applied Durable Object migration tags in `wrangler.jsonc`; add a new tag for new SQLite-backed classes.
- Regenerate `worker-configuration.d.ts` with `vp run cf-typegen`; do not edit it by hand.
- Generate `.react-router/` types with `vp exec react-router typegen`; do not edit generated files.
- Use `*.test.ts` / `*.test.tsx` for Vitest and `*.spec.ts` for Playwright; follow `docs/testing.md` for Workers-runtime mocks.

## External References

| Need                                   | File                                               |
| -------------------------------------- | -------------------------------------------------- |
| Setup and deployment                   | `README.md`, `.dev.vars.example`, `wrangler.jsonc` |
| Development and toolchain pins         | `docs/development.md`                              |
| Architecture, security, agent behavior | `docs/architecture.md`                             |
| REST API contract                      | `docs/api.md`                                      |
| Testing and coverage                   | `docs/testing.md`, `playwright.config.ts`          |
| CI checks                              | `.github/workflows/ci.yml`                         |
| Maintenance backlog                    | `docs/plan.md`                                     |
