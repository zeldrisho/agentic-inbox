// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
  Badge,
  Button,
  DropdownMenu,
  Loader,
  Tooltip,
  useKumoToastManager,
} from "@cloudflare/kumo";
import { SquareButton } from "~/components/ui/SquareButton";
import {
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  CaretDownIcon,
  RobotIcon,
  StopIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { useUIStore } from "~/hooks/useUIStore";
import { useMailbox, useUpdateMailbox } from "~/queries/mailboxes";
import { AUTOROUTE_SENTINEL, FALLBACK_MODELS } from "../../shared/models";
import type { MailboxSettings } from "~/types";
import type { UIMessage } from "ai";
import { MessageBubble } from "~/components/agent/MessageBubble";
import { extractDraftReplyResult } from "~/components/agent/tool-parts";

/**
 * Renders the connected email agent chat interface for a mailbox.
 *
 * @param mailboxId - The mailbox identifier used to create the email agent session.
 * @param useAgent - Hook used to create the email agent.
 * @param useAgentChat - Hook used to manage the agent conversation.
 */
type ModelOption = { id: string; name: string; task?: string; functionCalling?: boolean };

/**
 * Renders the mailbox-specific email agent chat interface.
 *
 * @param mailboxId - The mailbox identifier used to load settings and connect the agent session.
 * @param useAgent - Agent connection hook used to create the email agent session.
 * @param useAgentChat - Chat hook used to manage messages and generation state.
 */
function AgentChatConnected({
  mailboxId,
  useAgent,
  useAgentChat,
}: {
  mailboxId: string;
  useAgent: typeof import("agents/react").useAgent;
  useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");
  const { startCompose } = useUIStore();
  const { data: mailbox } = useMailbox(mailboxId);
  const updateMailbox = useUpdateMailbox();
  const toastManager = useKumoToastManager();
  const currentModel = mailbox?.settings?.agentModel || AUTOROUTE_SENTINEL;
  const modelLabel =
    currentModel === AUTOROUTE_SENTINEL
      ? "autoroute"
      : currentModel.split("/").pop() || currentModel;
  const [models, setModels] = useState<ModelOption[]>(() =>
    FALLBACK_MODELS.map((id) => ({
      id,
      name: id.split("/").pop() || id,
      task: "Text Generation",
      functionCalling: true,
    })),
  );
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);

  const agent = useAgent({ agent: "EmailAgent", name: mailboxId });
  const { messages, sendMessage, status, setMessages, stop } = useAgentChat({ agent });
  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const fetchModels = async (refresh = false) => {
    setIsRefreshingModels(true);
    try {
      const url = refresh ? "/api/v1/models?refresh=1" : "/api/v1/models";
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      // SAFETY: same-origin JSON, shape validated below
      const data = (await res.json()) as { models: ModelOption[]; warning?: string };
      if (Array.isArray(data.models) && data.models.length > 0) setModels(data.models);
    } catch {
      // keep fallback
    } finally {
      setIsRefreshingModels(false);
    }
  };

  useEffect(() => {
    void fetchModels(false);
  }, []);

  const handleModelChange = async (next: string) => {
    if (!mailbox || next === currentModel || isSwitchingModel) return;
    setIsSwitchingModel(true);
    try {
      // eslint-disable-next-line unicorn/no-useless-fallback-in-spread
      const nextSettings: MailboxSettings = {
        ...mailbox.settings,
        agentModel: next,
      };
      await updateMailbox.mutateAsync({
        mailboxId,
        settings: nextSettings,
      });
      // No success toast — the selector + header badge already reflect the switch.
    } catch {
      toastManager.add({ title: "Failed to switch model", variant: "error" });
    } finally {
      setIsSwitchingModel(false);
    }
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    setInputValue("");
    void sendMessage({ text });
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestedPrompts = [
    "Show me the latest inbox emails",
    "Any unread emails?",
    "Draft a response to the latest email",
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-kumo-line shrink-0">
        <div className="flex items-center gap-2">
          <Badge variant="beta">AI</Badge>
          <span className="text-xs text-kumo-subtle">Email Agent</span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-kumo-fill text-kumo-subtle font-mono truncate max-w-[140px]"
            title={currentModel}
          >
            {modelLabel}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isStreaming && <Loader size="sm" />}
          {messages.length > 0 && (
            <Tooltip content="Clear chat" asChild>
              <SquareButton
                variant="ghost"
                size="sm"
                icon={<TrashIcon size={14} />}
                onClick={() => {
                  if (window.confirm("Clear chat history?")) {
                    setMessages([]);
                  }
                }}
                aria-label="Clear chat"
              />
            </Tooltip>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-kumo-brand/10">
              <RobotIcon size={24} weight="duotone" className="text-kumo-brand" />
            </div>
            <p className="text-xs text-kumo-subtle text-center leading-relaxed px-4">
              I can read emails, search conversations, and draft replies.
            </p>
            <div className="flex flex-col gap-1.5 w-full">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage({ text: prompt })}
                  className="text-left px-3 py-2 rounded-lg border border-kumo-line text-xs text-kumo-strong hover:bg-kumo-tint hover:border-kumo-fill-hover transition-colors cursor-pointer bg-transparent"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={isStreaming}
                onAction={(action) => {
                  if (action !== "edit") return;
                  editDraftInComposer(msg);
                }}
              />
            ))}
            {isStreaming && (
              <div className="flex gap-2">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-kumo-fill text-kumo-default">
                  <RobotIcon size={12} weight="bold" />
                </div>
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-kumo-elevated border border-kumo-line rounded-bl-sm">
                  <Loader size="sm" />
                  <span className="text-xs text-kumo-subtle">Thinking...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model switch + Input — switch lives near send for instant session change */}
      <div className="shrink-0 border-t border-kumo-line px-3 py-2 space-y-2">
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<CaretDownIcon size={12} />}
                  disabled={isSwitchingModel}
                  loading={isSwitchingModel}
                  aria-label="Agent model"
                  className="flex-1 min-w-0 justify-between"
                >
                  <span className="truncate">{modelLabel}</span>
                </Button>
              }
            />
            <DropdownMenu.Content align="start" className="w-64">
              <DropdownMenu.RadioGroup
                value={currentModel}
                onValueChange={(value) => void handleModelChange(value)}
              >
                <DropdownMenu.RadioItem value={AUTOROUTE_SENTINEL}>
                  Autoroute — recommended
                  <DropdownMenu.RadioItemIndicator />
                </DropdownMenu.RadioItem>
                <DropdownMenu.Separator />
                {models.map((m) => (
                  <DropdownMenu.RadioItem key={m.id} value={m.id}>
                    <span className="flex flex-col min-w-0">
                      <span className="truncate">{m.name}</span>
                      <span className="text-[10px] text-kumo-subtle truncate font-mono">
                        {m.id}
                        {m.functionCalling ? " · tools" : ""}
                      </span>
                    </span>
                    <DropdownMenu.RadioItemIndicator />
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu>
          <Tooltip content="Refresh model list" asChild>
            <SquareButton
              variant="ghost"
              size="sm"
              icon={<ArrowsClockwiseIcon size={14} />}
              loading={isRefreshingModels}
              onClick={() => void fetchModels(true)}
              aria-label="Refresh model list"
            />
          </Tooltip>
        </div>
        {isStreaming ? (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              icon={<StopIcon size={14} weight="fill" />}
              onClick={() => stop()}
            >
              Stop generating
            </Button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5">
            <textarea
              ref={inputRef}
              id="agent-chat-input"
              name="agent-chat-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask your email agent..."
              rows={1}
              aria-label="Chat message input"
              className="flex-1 resize-none rounded-lg border border-kumo-line bg-kumo-control px-3 py-2 text-xs text-kumo-default placeholder:text-kumo-subtle focus:outline-none focus:ring-1 focus:ring-kumo-ring min-h-[36px] max-h-[100px]"
              style={{ height: "auto", overflow: "hidden" }}
              onInput={(e) => {
                // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
                const t = e.target as HTMLTextAreaElement;
                t.style.height = "auto";
                t.style.height = `${Math.min(t.scrollHeight, 100)}px`;
                t.style.overflow = t.scrollHeight > 100 ? "auto" : "hidden";
              }}
            />
            <SquareButton
              variant="primary"
              size="sm"
              disabled={!inputValue.trim()}
              icon={<ArrowUpIcon size={14} weight="bold" />}
              onClick={handleSend}
              aria-label="Send message"
            />
          </div>
        )}
      </div>
    </div>
  );

  /**
   * Opens the composer pre-filled with a saved `draft_reply` result; when no
   * draft payload is found in the message, asks the agent to re-share it.
   */
  function editDraftInComposer(msg: UIMessage) {
    const draftData = extractDraftReplyResult(msg);
    if (!draftData) {
      void sendMessage({
        text: "Let me edit this draft first. Show me what you have so I can modify it.",
      });
      return;
    }
    startCompose({
      mode: "reply",
      originalEmail: null,
      draftEmail: {
        id: draftData.id || "",
        subject: draftData.subject || "",
        sender: mailboxId,
        recipient: draftData.to || "",
        date: new Date().toISOString(),
        read: true,
        starred: false,
        body: draftData.body || "",
      },
    });
  }
}

export default function AgentPanel() {
  const { mailboxId } = useParams<{ mailboxId: string }>();
  const [hooks, setHooks] = useState<{
    useAgent: typeof import("agents/react").useAgent;
    useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
  } | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([import("agents/react"), import("@cloudflare/ai-chat/react")])
      .then(([a, c]) =>
        setHooks({
          useAgent: a.useAgent,
          useAgentChat: c.useAgentChat,
        }),
      )
      .catch((err) => {
        console.error("Failed to load agent modules:", err);
        setLoadError("Failed to connect to agent. Reload to retry.");
      });
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center">
        <span className="text-xs text-kumo-error">{loadError}</span>
      </div>
    );
  }

  if (!hooks) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <Loader size="base" />
        <span className="text-xs text-kumo-subtle">Connecting...</span>
      </div>
    );
  }

  return (
    <AgentChatConnected
      mailboxId={mailboxId ?? "default"}
      useAgent={hooks.useAgent}
      useAgentChat={hooks.useAgentChat}
    />
  );
}
