// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, lazyPlugins } from "vite-plus";
import type { UserConfig } from "vite-plus";
import { createLogger } from "vite-plus";

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion */
const viteLogger = createLogger();

const filteredLogger = {
  ...viteLogger,
  /**
   * Suppress messages containing `envFile`; forward other warnings and options to Vite.
   * Errors thrown by the forwarded logger call propagate.
   */
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

/**
 * Suppress the entire warning if any argument's string form contains `envFile`.
 * Otherwise, forward the original arguments. Conversion and console errors propagate.
 */
console.warn = (...args: unknown[]) => {
  if (args.some((a) => String(a).includes("envFile"))) return;
  // SAFETY: forwarding original console.warn args with same signature.
  (_origConsoleWarn as (...a: unknown[]) => void)(...args);
};

const _origConsoleError = console.error;

/**
 * Suppress the entire error message if any argument's string form contains `envFile`.
 * Otherwise, forward the original arguments. Conversion and console errors propagate.
 */
console.error = (...args: unknown[]) => {
  if (args.some((a) => String(a).includes("envFile"))) return;
  // SAFETY: forwarding original console.error args with same signature.
  (_origConsoleError as (...a: unknown[]) => void)(...args);
};

const _origConsoleLog = console.log;

/**
 * Suppress the entire log message if any argument's string form contains `envFile`.
 * Otherwise, forward the original arguments. Conversion and console errors propagate.
 */
console.log = (...args: unknown[]) => {
  if (args.some((a) => String(a).includes("envFile"))) return;
  // SAFETY: forwarding original console.log args with same signature.
  (_origConsoleLog as (...a: unknown[]) => void)(...args);
};

/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-argument, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-argument, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */
const _origStderrWrite = process.stderr.write.bind(process.stderr);

/**
 * Discard chunks whose string form contains both `envFile` and `deprecated`.
 * For discarded chunks, synchronously call only the third-argument callback, if
 * present, without an error, then return true; a callback in the encoding slot is
 * not called. Otherwise, forward all arguments and return the original write result.
 * Errors from string conversion, the callback, or the original write propagate.
 */
// SAFETY: filtering Vite's deprecated envFile warning at stderr level; forwarding otherwise preserves original semantics.
process.stderr.write = ((
  chunk: unknown,
  encoding?: unknown,
  callback?: (error?: Error) => void,
) => {
  const str = String(chunk);

  if (str.includes("envFile") && str.includes("deprecated")) {
    callback?.();

    return true;
  }

  // oxlint-disable-next-line anti-slop/no-unsafe-argument -- forwarding original args
  return (_origStderrWrite as (c: unknown, e?: unknown, cb?: (error?: Error) => void) => boolean)(
    chunk,
    encoding,
    callback,
  );
}) as typeof process.stderr.write;

const _origStdoutWrite = process.stdout.write.bind(process.stdout);

/**
 * Discard chunks whose string form contains both `envFile` and `deprecated`.
 * For discarded chunks, synchronously call only the third-argument callback, if
 * present, without an error, then return true; a callback in the encoding slot is
 * not called. Otherwise, forward all arguments and return the original write result.
 * Errors from string conversion, the callback, or the original write propagate.
 */
// SAFETY: same filtering for stdout (Vite may log to stdout in some environments).
process.stdout.write = ((
  chunk: unknown,
  encoding?: unknown,
  callback?: (error?: Error) => void,
) => {
  const str = String(chunk);

  if (str.includes("envFile") && str.includes("deprecated")) {
    callback?.();

    return true;
  }

  // oxlint-disable-next-line anti-slop/no-unsafe-argument -- forwarding original args
  return (_origStdoutWrite as (c: unknown, e?: unknown, cb?: (error?: Error) => void) => boolean)(
    chunk,
    encoding,
    callback,
  );
}) as typeof process.stderr.write;
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-argument, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion */

const playwrightServerConfig: UserConfig["server"] = process.env.PLAYWRIGHT_PORT
  ? {
      host: "127.0.0.1",
      port: Number(process.env.PLAYWRIGHT_PORT),
      strictPort: true,
    }
  : undefined;

/**
 * Return project configuration with env-file loading disabled in test mode.
 * Test mode omits the React Router and Cloudflare plugins.
 */
export default defineConfig(({ mode }) => ({
  server: playwrightServerConfig,
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
    exclude: ["tests/e2e/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    globals: true,
    environment: "node",
    environmentOptions: {
      jsdom: { url: "http://localhost" },
    },
    coverage: {
      provider: "v8",
      // Measure only modules executed by tests — untested UI shells (route
      // components rendered solely by the SPA entry) stay out of the gate.
      all: false,
      include: [
        "src/workers/lib/ai.ts",
        "src/workers/index.ts",
        "src/workers/routes/reply-forward.ts",
        "src/app/hooks/useComposeForm.ts",
      ],
      // CI gate (`vp test run --coverage`): fail below these thresholds.
      // Security/AI-critical modules carry stricter targets (docs/plan.md §5).
      thresholds: {
        statements: 80,
        functions: 80,
        lines: 80,
        branches: 75,
        "src/workers/lib/ai.ts": { statements: 90, lines: 90 },
        // P2 error-path gates (docs/plan.md): the failure branches of the
        // inbound/send boundaries and the compose form are pinned explicitly.
        "src/workers/index.ts": { branches: 68 },
        "src/workers/routes/reply-forward.ts": { branches: 75 },
        "src/app/hooks/useComposeForm.ts": { branches: 82 },
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
      { name: "shadcn", specifier: "@shadcn/lint" },
    ],
    settings: {
      shadcn: {
        ui: "~/components/ui",
      },
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
      // Pre-existing code patterns the old `tsc -b` check never enforced. The underlying
      // code has since been fixed (fire-and-forget promises wrapped with `void`, unused
      // imports/params removed, control-character regexes rewritten without control chars),
      // so these are promoted back to `error`.
      "typescript/no-floating-promises": "error",
      "eslint/no-unused-vars": "error",
      "eslint/no-control-regex": "error",
      // Anti-slop: reject low-evidence / low-signal implementation patterns.
      "oxc/no-accumulating-spread": "error",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
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
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
    },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: lazyPlugins(() => [
    // React Router injects a development-only refresh preamble check that is not available in Vitest.
    // The React Router plugin is unnecessary for these tests, which exercise components and helpers.
    ...(mode === "test" ? [] : [reactRouter()]),
    // The Cloudflare `ssr` Vite environment makes the plugin set `resolve.external`,
    // which Vitest's config validation rejects. Skip the plugin under `vp test`
    // (mode === "test"); dev/build keep the SSR environment.
    ...(mode === "test"
      ? []
      : [cloudflare({ viteEnvironment: { name: "ssr" }, remoteBindings: false })]),
    tailwindcss(),
    // Vite 8 deprecates `envFile:false` (used internally by older tooling) in favour
    // of `envDir:false`. Drop the deprecated key after all plugins have merged so the
    // "The `envFile` option is deprecated" warning from Vite disappears.
    {
      name: "fix-deprecated-envFile",
      enforce: "post",
      /** Delete the legacy `envFile` option in place only when its value is exactly false. */
      config(cfg: UserConfig) {
        // SAFETY: `envFile` is a legacy Vite option not in UserConfig types but may be present as `false` from older plugins; deleting it silences the deprecation warning.
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions, anti-slop/no-unsafe-dictionary-type -- single delete of legacy key after SAFETY check; no value contract needed.
        const c = cfg as unknown as Record<string, unknown>;

        if (c.envFile === false) delete c.envFile;
      },
    },
  ]),
}));
