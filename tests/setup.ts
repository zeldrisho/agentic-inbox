// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Vitest setup file (runs before each test file).
//
// React Router's dev plugin injects a react-refresh preamble check into
// `.tsx` modules. Under Vitest those modules never load the real preamble,
// so stub the flag whenever a DOM is available. Must live here because the
// injected check executes before any user code inside the wrapped module.
if (typeof window !== "undefined") {
  // SAFETY: React Router dev plugin guarantees __vite_plugin_react_preamble_installed__
  // exists on window during dev. In tests, we stub it before any module loads, ensuring
  // the check never throws. The boolean type is enforced by the plugin's injected code.
  (
    window as unknown as { __vite_plugin_react_preamble_installed__: boolean }
  ).__vite_plugin_react_preamble_installed__ = true;

  // Seed no-op refresh hooks. Each fast-refresh-wrapped module saves these as
  // "previous" values and restores them after evaluation, so seeding here keeps
  // $RefreshSig$/$RefreshReg$ callable between module loads and at render time.
  // SAFETY: React refresh runtime (vite-plugin-react) guarantees $RefreshReg$ and
  // $RefreshSig$ shapes during dev. We stub them in tests to match the runtime contract,
  // preventing undefined-function errors when fast-refresh-wrapped modules execute.
  const refreshWindow = window as unknown as {
    $RefreshReg$?: (type: unknown, id: string) => void;
    $RefreshSig$?: () => <T>(type: T) => T;
  };
  refreshWindow.$RefreshReg$ = () => {};
  refreshWindow.$RefreshSig$ = () => (type) => type;
}
