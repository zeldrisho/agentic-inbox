// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Consolidated date formatting utilities.
 *
 * Previously spread across `app/lib/utils.ts` (4 functions) and
 * `workers/lib/html.ts` (`formatEmailDate`). Now one canonical set
 * imported by both the frontend and backend.
 */

/**
 * Safely parses a date string.
 *
 * @param dateStr - The date string to parse
 * @returns The parsed date, or `null` if the input is missing or invalid
 */
function safeParse(dateStr: string | undefined | null): Date | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Formats a date for display in an email list.
 *
 * @param dateStr - The date string to format
 * @returns A localized time for dates today, a localized month and day for dates in the current year, a localized month, day, and year for older dates, or the original string if it is invalid
 */
export function formatListDate(dateStr: string): string {
  const date = safeParse(dateStr);
  if (!date) return dateStr;

  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Formats a date for display in an email detail header.
 *
 * @param dateStr - The date string to format.
 * @returns The localized date and time, or the original string if it is invalid.
 */
export function formatDetailDate(dateStr: string): string {
  const date = safeParse(dateStr);
  if (!date) return dateStr;

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats a valid date as a localized hour and minute.
 *
 * @param dateStr - The date string to format
 * @returns The localized time, or the original string if the date is invalid
 */
export function formatShortDate(dateStr: string): string {
  const date = safeParse(dateStr);
  if (!date) return dateStr;

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats a date for quoted replies and backend-generated quoted blocks.
 *
 * @param dateStr - The date string to format
 * @returns A localized date string, the original input if invalid, or an empty string if absent
 */
export function formatQuotedDate(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const date = safeParse(dateStr);
  if (!date) return dateStr;

  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
