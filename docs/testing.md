# Testing

How the test suite is organized, how to run it, and the patterns required to
test Workers-runtime code under Vitest.

## Commands

| Task                       | Command                  |
| -------------------------- | ------------------------ |
| Single run                 | `vp test`                |
| Watch mode                 | `vp test watch`          |
| Run with coverage **gate** | `vp test run --coverage` |
| Real-browser E2E           | `vp run test:e2e`        |

The coverage run is a hard gate in CI (`.github/workflows/ci.yml`) and fails
below the thresholds configured in `vite.config.ts:test.coverage.thresholds`:

- global: statements / functions / lines ≥ 80%, branches ≥ 75%
- `workers/lib/ai.ts`: statements / lines ≥ 90% (security-critical)
- P2 error-path floors (docs/plan.md): `workers/index.ts` branches ≥ 68%,
  `workers/routes/reply-forward.ts` branches ≥ 75%,
  `app/hooks/useComposeForm.ts` branches ≥ 82%

Coverage measures the four gated modules when executed by tests (v8 provider).
Untested UI shells (route components rendered only by the SPA entry) are
outside the gate.

## Layout

| Path                                                    | Scope                                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `tests/shared/`, `tests/workers/lib/`, `tests/app/lib/` | Unit tests, mirroring source layout                                                                           |
| `tests/integration/`                                    | API routes (Hono `app.fetch()`), MailboxDO, tools, MCP wiring, agent gating, inbound email, Access middleware |
| `tests/components/`                                     | jsdom + React Testing Library component renders                                                               |
| `tests/e2e/`                                            | `*.test.ts`: jsdom simulation of critical flows; `*.spec.ts`: Playwright real-browser E2E                     |
| `tests/setup.ts`                                        | Global setup (registered as `setupFiles` in `vite.config.ts`)                                                 |

Environments: `node` by default; `jsdom` via `environmentMatchGlobs` for
`tests/components/**` and `tests/e2e/**` (or a `// @vitest-environment jsdom`
pragma). Config lives only in `vite.config.ts:test` — no separate vitest config.

## Real-browser E2E (Playwright)

`tests/e2e/send-draft.spec.ts` ports the jsdom send→draft simulation to real
Chromium against `vp run dev` (local Durable Objects/R2, Access skipped), plus
an agent model-switch flow. Config: `playwright.config.ts` (starts the dev
server itself). Vitest never picks the spec up — its include pattern only
matches `*.test.{ts,tsx}`. The jsdom file (`tests/e2e/send-draft.test.ts`)
stays as the CI-fast fallback; the Playwright suite runs explicitly via
`vp run test:e2e`. One-time setup: `vp exec playwright install chromium
--with-deps` (on Fedora WSL the deps tooling falls back to apt — install the
dnf equivalents manually instead: nss, nspr, atk, at-spi2*, cups-libs,
libdrm, libXcomposite/Xdamage/Xrandr/Xcursor/Xi, mesa-libgbm, pango,
alsa-lib, libxkbcommon).

Selector notes learned while writing the specs:

- Kumo `Input` renders a truncated placeholder on the DOM node even when a
  longer one is passed — select by `getByPlaceholder` with the short form or
  by accessible name from the ARIA snapshot.
- Kumo `Dialog` does not expose `role="dialog"`; scope compose-panel fields
  by placeholder instead.
- Kumo `DropdownMenu.RadioItem` renders as `menuitemradio`; wait for the menu
  animation with `expect(...).toBeVisible()` before counting items.

## Testing Workers-runtime code

Workers-only specifiers and heavy dependency chains must be mocked before
importing worker modules. Working recipes (see existing integration tests):

| Import                                    | Why it needs mocking                                                | Recipe                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `cloudflare:workers`                      | Only exists in the Workers runtime                                  | `vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }))`   |
| `drizzle-orm/durable-sqlite`              | Pulls `@opentelemetry/api`, whose ESM build fails under native Node | `vi.mock(..., () => ({ drizzle: vi.fn(() => ({})) }))`                 |
| `agents` / `agents/mcp`                   | Loads the `ai` package → same broken OTel chain                     | Stub with minimal classes/fns                                          |
| `@modelcontextprotocol/sdk/server/mcp.js` | Heavy SDK not needed for handler-level tests                        | Replace `McpServer` with a capture-registry stub                       |
| `@cloudflare/ai-chat`                     | Base class of `EmailAgent`; imports `ai`                            | Simple base class setting `env`/`name` + `persistMessages`             |
| `jose`                                    | Access JWT verification would need a real JWKS                      | Mock `jwtVerify`/`createRemoteJWKSet`; use `vi.hoisted` for shared fns |

Notes learned the hard way:

- `vi.mock` factories are **hoisted** — reference shared mocks via `vi.hoisted()`.
- `workers/app.ts` re-exports `MailboxDO` and `EmailAgent`, so importing it
  pulls their whole chains; mock `"drizzle-orm/durable-sqlite"` and
  `"workers/agent"` when testing the Access middleware.
- Production-only branches guard on `import.meta.env.DEV`. Vitest bakes
  `DEV=true` at transform time and `vi.stubEnv("MODE", ...)` does **not** flip
  it — mutate the shared env object instead:
  `(import.meta.env as { DEV: boolean }).DEV = false`.
- Drizzle terminal ops (`get()`/`all()`/`run()`) are **synchronous**; async
  mock fns silently return Promises and break assertions.
- The constructor runs migrations first — assert against the **last**
  `sql.exec` call (`sql.calls.at(-1)`), not `calls[0]`.

## Component rendering

React Router's dev plugin injects a react-refresh preamble check into `.tsx`
modules. Tests never load the real preamble, so `tests/setup.ts` seeds
`window.__vite_plugin_react_preamble_installed__` plus persistent no-op
`$RefreshReg$`/`$RefreshSig$` hooks (each wrapped module saves/restores them,
so seeding keeps them callable between loads and at render time).

Compose UI needs providers: `QueryClientProvider > LinkProvider >
TooltipProvider > Toasty` (see `app/root.tsx`) and a `MemoryRouter` for
`useParams`.

## Conventions

- Test files are excluded from Oxlint anti-slop rules and formatting
  (`**/*.test.ts(x)`, `tests/setup.ts`) because they need mocks and assertions.
- Any remaining type assertion in prod or test code carries a `// SAFETY:`
  comment stating its invariant.
- Prefer driving HTTP behavior through `app.fetch(req, env, ctx)` with mocked
  bindings over module mocks when possible; mock modules only at runtime
  boundaries listed above.
