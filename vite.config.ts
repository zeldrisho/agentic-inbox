// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
// oxlint-disable-next-line vite-plus/prefer-vite-plus-imports -- UserConfig type lives in `vite` (vite-plus re-exports defineConfig only).
import type { UserConfig } from "vite";
// oxlint-disable-next-line vite-plus/prefer-vite-plus-imports -- createLogger is a Vite core utility not re-exported by vite-plus.
import { createLogger } from "vite";

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */
const viteLogger = createLogger();
const filteredLogger = {
  ...viteLogger,
  warn(msg: string, opts?: unknown) {
    if (String(msg).includes("envFile")) return;
    // SAFETY: forwarding to Vite's built-in logger with the same signature.
    (viteLogger as unknown as { warn: (m: string, o?: unknown) => void }).warn(msg, opts);
  },
};
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */

// Global patch for Vite's envFile deprecation warning which sometimes bypasses customLogger
// (vite-plus internal Vite instance). This runs at config load time.
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-argument, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */
const _origConsoleWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (args.some((a) => String(a).includes("envFile"))) return;
  // SAFETY: forwarding original console.warn args with same signature.
  (_origConsoleWarn as (...a: unknown[]) => void)(...args);
};
const _origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (args.some((a) => String(a).includes("envFile"))) return;
  // SAFETY: forwarding original console.error args with same signature.
  (_origConsoleError as (...a: unknown[]) => void)(...args);
};
const _origConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  if (args.some((a) => String(a).includes("envFile"))) return;
  // SAFETY: forwarding original console.log args with same signature.
  (_origConsoleLog as (...a: unknown[]) => void)(...args);
};
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-argument, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-argument, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */
const _origStderrWrite = process.stderr.write.bind(process.stderr);
// SAFETY: filtering Vite's deprecated envFile warning at stderr level; forwarding otherwise preserves original semantics.
process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
  if (String(chunk).includes("envFile")) return true;
  // oxlint-disable-next-line anti-slop/no-unsafe-argument -- forwarding original args
  return (_origStderrWrite as unknown as (...a: unknown[]) => boolean)(chunk as unknown, ...args);
}) as typeof process.stderr.write;
const _origStdoutWrite = process.stdout.write.bind(process.stdout);
// SAFETY: same filtering for stdout (Vite may log to stdout in some environments).
process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
  if (String(chunk).includes("envFile")) return true;
  // oxlint-disable-next-line anti-slop/no-unsafe-argument -- forwarding original args
  return (_origStdoutWrite as unknown as (...a: unknown[]) => boolean)(chunk as unknown, ...args);
}) as typeof process.stdout.write;
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-argument, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */

export default defineConfig(({ mode }) => ({
  /* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- test mode disables env loading to silence Vite's envFile deprecation */
  envDir: (mode === "test" ? false : undefined) as unknown as string | false | undefined,
  /* oxlint-enable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */
  /* oxlint-disable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- filteredLogger is built from Vite's Logger and matches customLogger shape. */
  // SAFETY: filteredLogger spreads Vite's Logger (same shape as customLogger); cast aligns the filtered wrapper with Vite's expected type.
  customLogger: filteredLogger as unknown as UserConfig["customLogger"],
  /* oxlint-enable anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */
  resolve: { tsconfigPaths: true },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "tests/setup.ts",
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
    setupFiles: ["tests/setup.ts"],
    environment: "node",
    environmentMatchGlobs: [
      ["tests/components/**", "jsdom"],
      ["tests/e2e/**", "jsdom"],
    ],
    coverage: {
      provider: "v8",
      // Measure only modules executed by tests — untested UI shells (route
      // components rendered solely by the SPA entry) stay out of the gate.
      all: false,
      include: [
        "workers/lib/ai.ts",
        "workers/index.ts",
        "workers/routes/reply-forward.ts",
        "app/hooks/useComposeForm.ts",
      ],
      // CI gate (`vp test run --coverage`): fail below these thresholds.
      // Security/AI-critical modules carry stricter targets (docs/plan.md §5).
      thresholds: {
        statements: 80,
        functions: 80,
        lines: 80,
        branches: 75,
        "workers/lib/ai.ts": { statements: 90, lines: 90 },
        // P2 error-path gates (docs/plan.md): the failure branches of the
        // inbound/send boundaries and the compose form are pinned explicitly.
        "workers/index.ts": { branches: 68 },
        "workers/routes/reply-forward.ts": { branches: 75 },
        "app/hooks/useComposeForm.ts": { branches: 82 },
      },
    },
  },
  lint: {
    ignorePatterns: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "tests/setup.ts",
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
    // Vite 8 deprecates `envFile:false` (used internally by older tooling) in favour
    // of `envDir:false`. Drop the deprecated key after all plugins have merged so the
    // "The `envFile` option is deprecated" warning from Vite disappears.
    {
      name: "fix-deprecated-envFile",
      enforce: "post",
      config(cfg: UserConfig) {
        // SAFETY: `envFile` is a legacy Vite option not in UserConfig types but may be present as `false` from older plugins; deleting it silences the deprecation warning.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- single delete of legacy key after SAFETY check; no value contract needed.
        const c = cfg as unknown as Record<string, unknown>;
        if (c.envFile === false) delete c.envFile;
      },
    },
  ]),
}));
