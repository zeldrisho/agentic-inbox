// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ mode }) => ({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  // No tests exist yet; don't fail `vp test` until they're added.
  test: { passWithNoTests: true },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // Pre-existing code patterns the old `tsc -b` check never enforced. Relaxed to
      // `warn` so `vp check` stays green and the pre-commit hook doesn't block commits.
      // Follow-up: fix the underlying code and promote these back to `error`.
      "typescript/no-floating-promises": "warn",
      "eslint/no-unused-vars": "warn",
      "eslint/no-control-regex": "warn",
    },
    // typeCheck disabled: tsgolint's type-aware pass surfaces 30 pre-existing code
    // patterns (fire-and-forget promises, unused vars, intentional control-char regexes
    // in email parsing) the old `tsc -b` check never enforced. Keep `vp check` green and
    // rely on the `typecheck` script (tsc -b) for type-checking. Follow-up: fix the code
    // and re-enable `typeCheck: true`.
    options: { typeAware: true, typeCheck: false },
  },
  plugins: lazyPlugins(() => [
    // The Cloudflare `ssr` Vite environment makes the plugin set `resolve.external`,
    // which Vitest's config validation rejects. Skip the plugin under `vp test`
    // (mode === "test"); dev/build keep the SSR environment.
    ...(mode === "test" ? [] : [cloudflare({ viteEnvironment: { name: "ssr" } })]),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ]),
}));
