// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Centralized typing for agent chat message parts.
 *
 * The chat UI receives generic `UIMessage`s — the client does not model the
 * agent's tool set — so tool invocations arrive either as unmodeled
 * `tool-<name>` literal part types or as `dynamic-tool` parts. Every helper
 * that inspects those parts lives here so the UI components never need
 * `as any` casts.
 */

import { isDynamicToolUIPart, type UIMessage } from "ai";

/** Shape of a `draft_reply` tool result as returned by the email agent. */
export interface DraftReplyResult {
  to?: string;
  subject?: string;
  body?: string;
  id?: string;
}

type AgentPart = UIMessage["parts"][number];

/**
 * Extracts the tool name represented by a message part.
 *
 * @param part - The message part to inspect
 * @returns The tool name, or `null` when the part does not represent a tool call
 */
export function getToolNameFromPart(part: AgentPart): string | null {
  if (isDynamicToolUIPart(part)) return part.toolName;
  if (part.type.startsWith("tool-")) return part.type.replace("tool-", "");
  return null;
}

/**
 * Extracts the invocation state of a tool-call part (`"running"` when the
 * part carries no state yet).
 *
 * @param part - The message part to inspect
 * @returns The tool call state
 */
export function getToolStateFromPart(part: AgentPart): string {
  if (isDynamicToolUIPart(part)) return part.state;
  // Static `tool-<name>` parts are a discriminated union with a `state`
  // member; the fallback covers exotic/older stream shapes.
  return "state" in part && part.state ? String(part.state) : "running";
}

/**
 * Determines whether a message contains a `draft_reply` tool invocation.
 *
 * @param message - The message to inspect
 * @returns `true` if the message contains a `draft_reply` tool invocation
 */
export function hasDraftReplyTool(message: UIMessage): boolean {
  return message.parts.some((part) => getToolNameFromPart(part) === "draft_reply");
}

/**
 * Extracts the first valid draft payload from a `draft_reply` tool call.
 *
 * @returns The draft data, or `null` when no valid payload is found.
 */
export function extractDraftReplyResult(message: UIMessage): DraftReplyResult | null {
  for (const part of message.parts) {
    if (getToolNameFromPart(part) !== "draft_reply") continue;
    // SAFETY: the streamed result field is named `output` per the AI SDK types
    // but older stream chunks carry it as `result`; accept either shape.
    const output =
      (part as { output?: DraftReplyResult }).output ??
      (part as { result?: DraftReplyResult }).result;
    if (!output || !("to" in output || "subject" in output || "body" in output)) continue;
    return output;
  }
  return null;
}
