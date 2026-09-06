# Vite+ toolchain

This repository uses [Vite+](https://viteplus.dev/guide/) for package
installation, formatting, linting, type checking, tests, and task execution.
Its unified CLI is `vp`. Installed Vite+ documentation is available under
`node_modules/vite-plus/docs`.

## Built-ins and project scripts

- `vp <name>` invokes a Vite+ built-in, such as `vp check` or `vp test`.
- `vp run <name>` invokes a `package.json` script, such as `vp run dev` or
  `vp run deploy`.
- Scripts cannot replace built-in command names, so `vp dev` and `vp run dev`
  may do different things. This project defines `dev`, `build`, `deploy`,
  `cf-typegen`, `typecheck`, `test:e2e`, and `preview` as scripts — always
  invoke them via `vp run <name>`.
- `vite.config.ts` is a Vite+ config (`defineConfig` from `vite-plus`) wiring
  the React Router, Cloudflare, and Tailwind plugins. Check it alongside
  `package.json` before choosing a command.

## Common commands

| Task                           | Command                  |
| ------------------------------ | ------------------------ |
| Install dependencies           | `vp install`             |
| Dev server (Vite + Cloudflare) | `vp run dev`             |
| Check (lint/format/typecheck)  | `vp check`               |
| Tests                          | `vp test run --coverage` |
| End-to-end tests               | `vp run test:e2e`        |
| Generate Cloudflare types      | `vp run cf-typegen`      |
| Typecheck                      | `vp run typecheck`       |
| Production build               | `vp run build`           |
| Build + deploy                 | `vp run deploy`          |
| Show environment diagnostics   | `vp env doctor`          |
| Show toolchain versions        | `vp toolchain`           |
| Explain a dependency           | `vp why <package>`       |

Use `vp help` for the command list and `vp <command> --help` for
command-specific options. The repository's selected versions are recorded in
`package.json` and `pnpm-lock.yaml` (`vite-plus@0.3.0`, pnpm 11 via
`devEngines.packageManager`).

## Review checklist

- Run `vp install` after pulling remote changes and before getting started.
- Run `vp check` and `vp test run --coverage` to format, lint, typecheck, and
  test changes.
- Run `vp run typecheck` after changing bindings, routes,
  `packages/shared/` types, or `worker-configuration.d.ts`.
- If setup, runtime, or package-manager behavior looks wrong, run
  `vp env doctor` and include its output when asking for help.
