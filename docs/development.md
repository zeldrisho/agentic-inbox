# Development

Setup, local development, deployment, and repository conventions.

## Prerequisites and install

Use Node 24+ and a Cloudflare account with Email Routing, Email Service,
Workers AI, and (for deployments) Cloudflare Access configured.

```bash
vp install
vp run dev       # local app; Access is skipped
vp run build
vp run deploy    # build + wrangler deploy
```

Local development does not exercise inbound email or MCP on a real Cloudflare
deployment. The `EMAIL` and `AI` bindings are remote; local tests/development
can therefore send real email and consume Workers AI. Use test recipients.

## Checks and tests

```bash
vp check
vp test run --coverage
vp run typecheck
vp run test:e2e
```

Run `vp run cf-typegen` after changing `wrangler.jsonc`; run `vp run typecheck`
after changing bindings, routes, shared types, or generated worker types. The
coverage gate and Workers-runtime mock recipes are in [`testing.md`](testing.md).

## Deploy configuration

`wrangler.jsonc` defines the R2 bucket, `EMAIL` send binding, Workers AI
binding, and `MailboxDO`, `EmailAgent`, and `EmailMCP` Durable Objects. Do not
edit `worker-configuration.d.ts` or `.react-router/` by hand; regenerate them.
Applied Durable Object migration tags must not be edited—add a new tag for a
new SQLite-backed class.

Set these production secrets with Wrangler, never in `wrangler.jsonc`:

- `DOMAINS`: comma-separated Email Routing domains.
- `POLICY_AUD` and `TEAM_DOMAIN`: Cloudflare Access configuration.

The worker fails closed in production when Access secrets are missing. Access
is the sole authorization boundary; see [`architecture.md`](architecture.md).

## Repository conventions

- Package management and scripts use Vite+ (`vp`); scripts always use `vp run`.
  `vp check` and `vp test` are Vite+ built-ins.
- Keep `workers/index.ts` handlers thin. Put business logic in Durable Objects
  and `workers/lib/`; shared client/worker code belongs in `packages/shared/`.
- Validate API bodies with Zod. Preserve same-origin CORS and the Cloudflare
  Access trust boundary.
- Intentional toolchain pins in `package.json` (including the `vite` alias and
  `@oxlint/plugins`) must not be removed without verifying pnpm isolation.

## Layout

- `app/`: React Router SPA
- `workers/`: Worker entry, Hono routes, Durable Objects, agent, MCP, and helpers
- `packages/shared/`: shared client/worker code, imported as `shared/*`
- `tests/`: unit, integration, component, and Playwright suites
- `wrangler.jsonc`: Cloudflare bindings and migrations

For the HTTP contract, see [`api.md`](api.md). For system design and security,
see [`architecture.md`](architecture.md).
