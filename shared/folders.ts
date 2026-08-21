// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Canonical folder ID constants.
 *
 * Every part of the stack — API routes, Durable Object, MCP, agent,
 * frontend sidebar — references folder IDs. This module is the single
 * source of truth so we don't scatter magic strings everywhere.
 */

export const Folders = {
  INBOX: "inbox",
  SENT: "sent",
  DRAFT: "draft",
  ARCHIVE: "archive",
  TRASH: "trash",
  SPAM: "spam",
} as const;

export type FolderId = (typeof Folders)[keyof typeof Folders];

/**
 * System folder IDs that appear in the sidebar (excludes spam).
 * Order here matches the sidebar display order.
 */
export const SYSTEM_FOLDER_IDS: readonly FolderId[] = [
  Folders.INBOX,
  Folders.SENT,
  Folders.DRAFT,
  Folders.ARCHIVE,
  Folders.TRASH,
];

/**
 * Human-readable display names for folder IDs.
 * Used in the sidebar, search result badges, and tool descriptions.
 */
export const FOLDER_DISPLAY_NAMES = {
  [Folders.INBOX]: "Inbox",
  [Folders.SENT]: "Sent",
  [Folders.DRAFT]: "Drafts",
  [Folders.ARCHIVE]: "Archive",
  [Folders.TRASH]: "Trash",
  [Folders.SPAM]: "Spam",
} satisfies Record<string, string>;

/** Formatted string for tool parameter descriptions (agent + MCP). */
export const FOLDER_TOOL_DESCRIPTION = "Folder to list: inbox, sent, draft, archive, trash";

/** Formatted string for move-email tool descriptions. */
export const MOVE_FOLDER_TOOL_DESCRIPTION = "Target folder: inbox, sent, draft, archive, trash";

/**
 * Resolves a folder ID to its human-readable display name.
 *
 * @param folderId - The folder ID to resolve, including IDs from untrusted sources
 * @returns The configured display name for a known folder, or the folder ID with its first character capitalized
 */
export function getFolderDisplayName(folderId: string): string {
  // SAFETY: folderId arrives as an untrusted API string; only known FolderId keys resolve,
  // and the `??` fallback covers any value outside that closed set.
  const name = FOLDER_DISPLAY_NAMES[folderId.toLowerCase() as FolderId];
  return name ?? folderId.charAt(0).toUpperCase() + folderId.slice(1);
}
