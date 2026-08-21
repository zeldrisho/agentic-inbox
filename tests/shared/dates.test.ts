// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect } from "vite-plus/test";
import { formatListDate, formatDetailDate, formatShortDate, formatQuotedDate } from "shared/dates";

describe("dates", () => {
  it("returns original string for invalid date", () => {
    expect(formatListDate("not-a-date")).toBe("not-a-date");
    expect(formatDetailDate("not-a-date")).toBe("not-a-date");
    expect(formatShortDate("bad")).toBe("bad");
    expect(formatQuotedDate("bad")).toBe("bad");
  });

  it("returns empty string for undefined quoted date", () => {
    expect(formatQuotedDate(undefined)).toBe("");
    expect(formatQuotedDate("")).toBe("");
  });

  it("formats quoted date in en-US locale", () => {
    const iso = "2025-01-15T10:30:00.000Z";
    const result = formatQuotedDate(iso);
    // Should contain month and year; locale is en-US
    expect(result).toContain("2025");
    expect(result).toContain("Jan");
  });

  it("formatListDate returns time today, date this year, or full date", () => {
    const now = new Date();
    const todayIso = now.toISOString();
    const todayResult = formatListDate(todayIso);
    // Today should contain ":" (time)
    expect(todayResult).toContain(":");

    const oldIso = "2020-06-15T10:00:00.000Z";
    const oldResult = formatListDate(oldIso);
    expect(oldResult).toContain("2020");
  });

  it("formatDetailDate returns localized string", () => {
    const iso = "2025-06-15T10:00:00.000Z";
    const result = formatDetailDate(iso);
    expect(result.length).toBeGreaterThan(5);
  });

  it("formatShortDate returns time", () => {
    const iso = "2025-06-15T14:30:00.000Z";
    const result = formatShortDate(iso);
    expect(result).toContain(":");
  });
});
