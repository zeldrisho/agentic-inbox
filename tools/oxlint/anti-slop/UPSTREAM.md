# Anti-slop provenance

- Source: `dmmulroy/anti-slop`, installed from the bundled `install-anti-slop` skill snapshot on 2026-09-14.
- Source commit: unknown; the skill bundle does not expose a recoverable upstream commit. Installed-tree manifest SHA-256: `c5255401fb1b6bcda057ec8a0f29eced8f3180b55d2d6c5a6904fad799fb9585`.
- Installed entry points: `tools/oxlint/anti-slop/index.ts` and the bundled optional `tools/oxlint/anti-slop/effect/index.ts` (not registered because this project has no direct `effect` dependency).
- Dependencies: `@oxlint/plugins` is pinned to `1.81.0`; `oxlint` is supplied by Vite+ and was not installed separately.
- Configuration: generic rules plus `oxc/no-accumulating-spread` are enabled in `vite.config.ts`; Vite+ lint and format ignores preserve agent tooling and vendored sources.
- Intentional deviation: the Effect plugin remains unregistered because `effect` is not a direct project dependency.
- Update note: the pre-update installation was preserved at `/tmp/anti-slop-preupdate-qDgaA2` while the incoming bundle was reviewed and merged.
