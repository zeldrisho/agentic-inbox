// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import { MoonIcon, SunIcon, MonitorIcon } from "@phosphor-icons/react";
import { SquareButton } from "~/components/ui/SquareButton";
import { useTheme } from "~/hooks/useTheme";

/**
 * Theme toggle button with autodetect (system) and manual control.
 * Cycles through light/dark/system or provides a dropdown.
 * For header we show a single toggle + tooltip indicating next mode.
 */
export function ThemeToggle() {
  const { mode, resolved, setMode } = useTheme();

  const getIcon = () => {
    if (mode === "system") return <MonitorIcon size={20} />;
    return resolved === "dark" ? <MoonIcon size={20} /> : <SunIcon size={20} />;
  };

  const getLabel = () => {
    if (mode === "system") return `Theme: system (${resolved}) — click for light`;
    if (mode === "light") return "Theme: light — click for dark";
    return "Theme: dark — click for system";
  };

  const cycleMode = () => {
    if (mode === "system") setMode("light");
    else if (mode === "light") setMode("dark");
    else setMode("system");
  };

  return (
    <Tooltip content={getLabel()} side="bottom" asChild>
      <SquareButton
        variant="ghost"
        icon={getIcon()}
        onClick={cycleMode}
        aria-label="Toggle theme"
      />
    </Tooltip>
  );
}

/**
 * Full theme selector with light/dark/system options for use in dialogs/settings.
 */
export function ThemeSelector() {
  const { mode, setMode } = useTheme();
  return (
    <div className="flex items-center gap-1 rounded-md border border-kumo-line p-1 bg-kumo-base w-fit">
      <button
        type="button"
        onClick={() => setMode("light")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm transition-colors ${mode === "light" ? "bg-kumo-fill font-medium text-kumo-default" : "text-kumo-subtle hover:text-kumo-default"}`}
        aria-pressed={mode === "light"}
      >
        <SunIcon size={14} /> Light
      </button>
      <button
        type="button"
        onClick={() => setMode("dark")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm transition-colors ${mode === "dark" ? "bg-kumo-fill font-medium text-kumo-default" : "text-kumo-subtle hover:text-kumo-default"}`}
        aria-pressed={mode === "dark"}
      >
        <MoonIcon size={14} /> Dark
      </button>
      <button
        type="button"
        onClick={() => setMode("system")}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm transition-colors ${mode === "system" ? "bg-kumo-fill font-medium text-kumo-default" : "text-kumo-subtle hover:text-kumo-default"}`}
        aria-pressed={mode === "system"}
      >
        <MonitorIcon size={14} /> System
      </button>
    </div>
  );
}
