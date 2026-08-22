// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button } from "@cloudflare/kumo";
import { PencilSimpleIcon, RobotIcon, UserIcon } from "@phosphor-icons/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { UIMessage } from "ai";
import { getToolNameFromPart, getToolStateFromPart, hasDraftReplyTool } from "./tool-parts";
import { ToolCallBadge } from "./ToolCallBadge";

/** Element overrides for assistant markdown rendering, styled to the panel. */
const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--color-link)", textDecoration: "underline" }}
    >
      {children}
    </a>
  ),
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-4 mb-2 last:mb-0 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li>{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="font-semibold text-sm mb-1">{children}</h3>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h4 className="font-semibold text-[13px] mb-1">{children}</h4>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h5 className="font-semibold text-[13px] mb-0.5">{children}</h5>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="bg-kumo-fill px-1 py-0.5 rounded text-[12px]">{children}</code>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-2">
      <table className="w-full text-xs border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="border-b border-kumo-line bg-kumo-fill/30">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="text-left px-2 py-1 font-semibold text-kumo-strong">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="px-2 py-1 border-b border-kumo-line/50">{children}</td>
  ),
};

/**
 * Renders an action for editing and sending a draft reply in the composer.
 *
 * @param onEdit - Called when the edit action is selected
 * @param disabled - Whether the edit action is unavailable
 */
function DraftActions({ onEdit, disabled }: { onEdit: () => void; disabled: boolean }) {
  return (
    <div className="flex gap-1.5 mt-1">
      <Button
        variant="primary"
        size="sm"
        icon={<PencilSimpleIcon size={14} />}
        onClick={onEdit}
        disabled={disabled}
      >
        Edit & send in composer
      </Button>
    </div>
  );
}

/**
 * Renders a chat message with formatted text, tool activity, and draft actions.
 *
 * @param message - The message and its content parts to display
 * @param onAction - Callback invoked when a draft action is selected
 * @param isStreaming - Whether the response is currently streaming
 * @returns The rendered message bubble
 */
export function MessageBubble({
  message,
  onAction,
  isStreaming,
}: {
  message: UIMessage;
  onAction?: (action: string) => void;
  isStreaming: boolean;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-kumo-brand text-kumo-inverse" : "bg-kumo-fill text-kumo-default"
        }`}
      >
        {isUser ? <UserIcon size={12} weight="bold" /> : <RobotIcon size={12} weight="bold" />}
      </div>
      <div
        className={`flex flex-col gap-1 max-w-[85%] min-w-0 ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        {message.parts.map((part, i) => {
          const key = `${message.id}-part-${i}`;
          if (part.type === "text" && part.text.trim()) {
            return (
              <div
                key={key}
                className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed break-words overflow-wrap-anywhere ${
                  isUser
                    ? "bg-kumo-brand text-kumo-inverse rounded-br-sm"
                    : "bg-kumo-elevated text-kumo-default border border-kumo-line rounded-bl-sm overflow-hidden"
                }`}
              >
                {isUser ? (
                  part.text
                ) : (
                  <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {part.text}
                  </Markdown>
                )}
              </div>
            );
          }
          const toolName = getToolNameFromPart(part);
          if (toolName) {
            return (
              <ToolCallBadge key={key} toolName={toolName} state={getToolStateFromPart(part)} />
            );
          }
          return null;
        })}
        {/* Show action buttons for draft replies */}
        {!isUser && hasDraftReplyTool(message) && onAction && (
          <DraftActions onEdit={() => onAction("edit")} disabled={isStreaming} />
        )}
      </div>
    </div>
  );
}
