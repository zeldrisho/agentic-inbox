// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Tooltip } from "@cloudflare/kumo";
import { SquareButton } from "~/components/ui/SquareButton";
import { CheckIcon, CopyIcon, PlugsIcon, WrenchIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";

/**
 * Renders a button that copies the supplied text to the clipboard and briefly indicates success.
 *
 * @param text - The text to copy to the clipboard
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable or permission denied — ignore silently
    }
  };

  return (
    <Tooltip content={copied ? "Copied!" : "Copy"} asChild>
      <SquareButton
        variant="ghost"

        size="sm"
        icon={
          copied ? (
            <CheckIcon size={12} weight="bold" className="text-kumo-success" />
          ) : (
            <CopyIcon size={12} />
          )
        }
        onClick={handleCopy}
        aria-label="Copy to clipboard"
      />
    </Tooltip>
  );
}

const TOOLS = [
  { name: "list_mailboxes", desc: "List all mailboxes" },
  { name: "list_emails", desc: "List emails in a folder" },
  { name: "get_email", desc: "Read a full email with body" },
  { name: "get_thread", desc: "Load a conversation thread" },
  { name: "search_emails", desc: "Search emails by query" },
  { name: "draft_reply", desc: "Draft a reply to an email" },
  { name: "send_reply", desc: "Send a reply" },
  { name: "send_email", desc: "Send a new email" },
  { name: "mark_email_read", desc: "Mark email as read/unread" },
  { name: "move_email", desc: "Move email to a folder" },
];

/**
 * Renders a panel for connecting to the email agent through MCP.
 *
 * @returns The MCP connection panel with the server URL and available tools.
 */
export default function MCPPanel() {
  const { mailboxId: _mailboxId } = useParams<{ mailboxId: string }>();
  const baseUrl =
    globalThis.window !== undefined
      ? globalThis.window.location.origin
      : "https://your-app.workers.dev";
  const mcpUrl = `${baseUrl}/mcp`;

  return (
    <div className="flex flex-col h-full">
      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Intro */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-kumo-brand/10">
              <PlugsIcon size={20} weight="duotone" className="text-kumo-brand" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-kumo-default">Connect via MCP</h3>
              <p className="text-xs text-kumo-subtle">Model Context Protocol</p>
            </div>
          </div>
          <p className="text-xs text-kumo-subtle leading-relaxed">
            This email agent exposes an MCP server so AI coding assistants can manage your inbox
            directly — read emails, search, draft replies, and send messages using natural language.
          </p>
        </div>

        {/* MCP URL */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-kumo-strong block">Server URL</label>
          <div className="relative group">
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
              <CopyButton text={mcpUrl} />
            </div>
            <div className="bg-kumo-recessed text-kumo-default font-mono text-[11px] px-3 py-2.5 pr-10 rounded-lg border border-kumo-line break-all leading-relaxed">
              {mcpUrl}
            </div>
          </div>
        </div>

        {/* Available tools */}
        <div className="space-y-2">
          <h4 className="text-xs uppercase tracking-wider font-semibold text-kumo-subtle px-0.5">
            Available Tools
          </h4>
          <div className="border border-kumo-line rounded-lg divide-y divide-kumo-line">
            {TOOLS.map((tool) => (
              <div key={tool.name} className="flex items-center gap-2.5 px-3 py-2">
                <WrenchIcon size={12} weight="bold" className="text-kumo-brand shrink-0" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-mono font-medium text-kumo-default">
                    {tool.name}
                  </span>
                </div>
                <span className="text-[11px] text-kumo-subtle shrink-0">{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
