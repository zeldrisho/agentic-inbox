// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useState, useCallback } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "kumo-theme-mode";

function getSystemTheme(): ResolvedTheme {
  if (globalThis.window === undefined) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function safeGetStoredMode(): ThemeMode {
  if (globalThis.window === undefined) return "system";
  try {
    // SAFETY: localStorage.getItem returns string | null; we validate against ThemeMode union on next line before using
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    return "system";
  } catch {
    return "system";
  }
}

function safeSetStoredMode(mode: ThemeMode): void {
  if (globalThis.window === undefined) return;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage write failed; ignore
  }
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return getSystemTheme();
  return mode;
}

function applyTheme(resolved: ResolvedTheme) {
  if (globalThis.document !== undefined) {
    document.documentElement.setAttribute("data-mode", resolved);
  }
}

/**
 * Hook that manages light/dark/system theme with autodetect and manual override.
 * Persists preference to localStorage and syncs data-mode attribute for Kumo tokens.
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => safeGetStoredMode());

  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(mode));

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    safeSetStoredMode(next);
    const r = resolveTheme(next);
    setResolved(r);
    applyTheme(r);
  }, []);

  const toggle = useCallback(() => {
    // Cycle: system -> light -> dark -> system  (or light <-> dark if you prefer)
    // Spec asks autodetect + manual, so we provide system + manual toggle.
    // Simple toggle between light/dark, preserving system as accessible via explicit selector.
    // For the header button we toggle resolved theme:
    const current = resolveTheme(mode);
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    setMode(next);
  }, [mode, setMode]);

  // Apply on mount and listen to system changes when in system mode
  useEffect(() => {
    const r = resolveTheme(mode);
    setResolved(r);
    applyTheme(r);
  }, [mode]);

  useEffect(() => {
    if (mode !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const r = getSystemTheme();
      setResolved(r);
      applyTheme(r);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [mode]);

  return { mode, resolved, setMode, toggle };
}
