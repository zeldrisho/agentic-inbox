// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Loader } from "@cloudflare/kumo";
import {
  ArrowBendUpLeftIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  TrashIcon,
  WrenchIcon,
} from "@phosphor-icons/react";

const TOOL_LABELS = {
  list_emails: {
    label: "Fetching emails",
    icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
  },
  get_email: {
    label: "Reading email",
    icon: <EyeIcon size={14} weight="bold" />,
  },
  get_thread: {
    label: "Loading thread",
    icon: <ArrowBendUpLeftIcon size={14} weight="bold" />,
  },
  search_emails: {
    label: "Searching",
    icon: <MagnifyingGlassIcon size={14} weight="bold" />,
  },
  draft_email: {
    label: "Drafting email",
    icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
  },
  draft_reply: {
    label: "Drafting reply",
    icon: <PaperPlaneTiltIcon size={14} weight="bold" />,
  },
  discard_draft: {
    label: "Discarding draft",
    icon: <TrashIcon size={14} weight="bold" />,
  },
  mark_email_read: {
    label: "Updating status",
    icon: <CheckCircleIcon size={14} weight="bold" />,
  },
  move_email: {
    label: "Moving email",
    icon: <EnvelopeSimpleIcon size={14} weight="bold" />,
  },
} satisfies Record<string, { label: string; icon: React.ReactNode }>;

/**
 * Renders a status badge for a tool call.
 *
 * @param toolName - The identifier of the tool call.
 * @param state - The current state of the tool call.
 */
export function ToolCallBadge({ toolName, state }: { toolName: string; state: string }) {
  // SAFETY: `toolName` is a dynamic tool identifier; it is a known key of TOOL_LABELS when recognized.
  const info = TOOL_LABELS[toolName as keyof typeof TOOL_LABELS] ?? {
    label: toolName,
    icon: <WrenchIcon size={14} weight="bold" />,
  };
  const isDone = state === "output-available" || state === "result" || state === "output-error";

  return (
    <div className="flex items-center gap-1.5 py-1 px-2 rounded bg-kumo-fill/50 text-xs">
      <span className="text-kumo-brand">{info.icon}</span>
      <span className="text-kumo-strong">{info.label}</span>
      {isDone ? (
        <CheckCircleIcon size={12} weight="fill" className="text-kumo-success ml-auto" />
      ) : (
        <Loader size="sm" className="ml-auto" />
      )}
    </div>
  );
}
