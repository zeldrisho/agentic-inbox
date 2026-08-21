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
  fmt: {
    ignorePatterns: [
      "**/*.test.ts",
      "**/*.test.tsx",
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    globals: true,
    environment: "node",
    environmentMatchGlobs: [
      ["tests/components/**", "jsdom"],
      ["tests/e2e/**", "jsdom"],
    ],
  },
  lint: {
    ignorePatterns: [
      "**/*.test.ts",
      "**/*.test.tsx",
      ".agent/**",
      ".agents/**",
      ".claude/**",
      ".codex/**",
      ".continue/**",
      ".cursor/**",
      ".gemini/**",
      ".opencode/**",
      ".pi/**",
      ".roo/**",
      ".windsurf/**",
      "tools/oxlint/anti-slop/**",
    ],
    jsPlugins: [
      { name: "vite-plus", specifier: "vite-plus/oxlint-plugin" },
      { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // Pre-existing code patterns the old `tsc -b` check never enforced. The underlying
      // code has since been fixed (fire-and-forget promises wrapped with `void`, unused
      // imports/params removed, control-character regexes rewritten without control chars),
      // so these are promoted back to `error`.
      "typescript/no-floating-promises": "error",
      "eslint/no-unused-vars": "error",
      "eslint/no-control-regex": "error",
      // Anti-slop: reject low-evidence / low-signal implementation patterns.
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: lazyPlugins(() => [
    // The Cloudflare `ssr` Vite environment makes the plugin set `resolve.external`,
    // which Vitest's config validation rejects. Skip the plugin under `vp test`
    // (mode === "test"); dev/build keep the SSR environment.
    ...(mode === "test"
      ? []
      : [cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false })]),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ]),
}));
