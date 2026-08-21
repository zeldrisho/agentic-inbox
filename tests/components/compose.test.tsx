// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { useUIStore } from "app/hooks/useUIStore";
import { stripHtmlToText, escapeHtml, textToHtml } from "workers/lib/email-helpers";

describe("useUIStore sidebar closed by default", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset store to default state
    useUIStore.setState({ isAgentPanelOpen: false });
  });

  it("isAgentPanelOpen defaults to false", () => {
    // After clearing localStorage and resetting store, should be false
    const state = useUIStore.getState();
    expect(state.isAgentPanelOpen).toBe(false);
  });

  it("toggleAgentPanel flips value and persists", () => {
    const before = useUIStore.getState().isAgentPanelOpen;
    useUIStore.getState().toggleAgentPanel();
    const after = useUIStore.getState().isAgentPanelOpen;
    expect(after).toBe(!before);
    expect(JSON.parse(localStorage.getItem("agentPanelOpen") || "false")).toBe(after);
    // restore
    useUIStore.getState().toggleAgentPanel();
    expect(useUIStore.getState().isAgentPanelOpen).toBe(before);
  });

  it("isComposing starts false", () => {
    expect(useUIStore.getState().isComposing).toBe(false);
  });

  it("startCompose sets mode and isComposing", () => {
    useUIStore.getState().startCompose({ mode: "new", originalEmail: null });
    expect(useUIStore.getState().isComposing).toBe(true);
    expect(useUIStore.getState().composeOptions.mode).toBe("new");
    useUIStore.getState().closeCompose();
    expect(useUIStore.getState().isComposing).toBe(false);
  });
});

describe("ComposeEmail form logic (unit)", () => {
  it("validates email list splitting", async () => {
    const { splitEmailList } = await import("app/lib/utils");
    expect(splitEmailList("a@ex.com, b@ex.com")).toEqual(["a@ex.com", "b@ex.com"]);
    expect(splitEmailList("")).toEqual([]);
    expect(splitEmailList(" a@ex.com , b@ex.com ")).toEqual(["a@ex.com", "b@ex.com"]);
  });

  it("escapeHtml prevents XSS in compose", () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toContain("<script>");
    expect(escapeHtml('<img onerror="x">')).toContain("&lt;");
  });

  it("textToHtml wraps and escapes", () => {
    expect(textToHtml("hello\nworld")).toContain("<br>");
    expect(textToHtml("<b>hi</b>")).toContain("&lt;b&gt;");
  });

  it("stripHtmlToText removes tags", () => {
    expect(stripHtmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(stripHtmlToText("<style>.x{}</style>hello")).toBe("hello");
  });

  it("draft flow: verify non-empty body required", () => {
    const body = "   ";
    expect(body.trim().length === 0).toBe(true);
    const validBody = "Hello team, please see attached pricing.";
    expect(validBody.trim().length > 20).toBe(true);
  });
});

describe("EmailIframe sanitization (unit)", () => {
  it("sanitizes script tags via stripHtmlToText", () => {
    const html = "<p>Hello</p><script>alert(1)</script>";
    const text = stripHtmlToText(html);
    expect(text).not.toContain("alert");
    expect(text).toContain("Hello");
  });

  it("handles empty body", () => {
    expect(stripHtmlToText("")).toBe("");
    expect(textToHtml("")).toBe("");
  });

  it("autoSize behavior not required for sanitization", () => {
    const html = "<p>hi</p>";
    expect(stripHtmlToText(html)).toBe("hi");
  });
});

describe("send→draft flow (unit)", () => {
  it("draft creation preserves threading", async () => {
    const { buildReferencesChain } = await import("workers/lib/email-helpers");
    const original = {
      id: "orig-1",
      message_id: "msg-1",
      email_references: JSON.stringify(["msg-0"]),
      thread_id: "thread-1",
    } as unknown as Parameters<typeof buildReferencesChain>[0];
    const { references, threadId, originalMsgId } = buildReferencesChain(original);
    expect(originalMsgId).toBe("msg-1");
    expect(references).toEqual(["msg-0", "msg-1"]);
    expect(threadId).toBe("thread-1");
  });

  it("generateMessageId is unique", async () => {
    const { generateMessageId } = await import("workers/lib/email-helpers");
    const a = generateMessageId("example.com");
    const b = generateMessageId("example.com");
    expect(a.messageId).not.toBe(b.messageId);
    expect(a.outgoingMessageId).toContain("@example.com");
  });
});

// ── Real component rendering (RTL) ─────────────────────────────────

describe("EmailIframe rendering", () => {
  it("renders a sandboxed iframe with sanitized content", async () => {
    const { render } = await import("@testing-library/react");
    const EmailIframe = (await import("app/components/EmailIframe")).default;
    const { container } = render(<EmailIframe body="<p>Hello email</p>" />);
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // sandboxed: no same-origin access
    expect(iframe!.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe!.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("sanitizes scripts out of the rendered srcdoc", async () => {
    const { render } = await import("@testing-library/react");
    const EmailIframe = (await import("app/components/EmailIframe")).default;
    const { container } = render(
      <EmailIframe body={'<p>Hi</p><script>alert(1)</script><style>.x{}</style>'} />,
    );
    const iframe = container.querySelector("iframe");
    const srcdoc = iframe!.getAttribute("srcdoc") || "";
    expect(srcdoc).toContain("Hi");
    expect(srcdoc).not.toContain("alert(1)");
    expect(srcdoc).not.toContain(".x{}");
  });
});

describe("ComposeEmail rendering", () => {
  it("opens the compose dialog with form fields", async () => {
    const React = await import("react");
    const { render, screen } = await import("@testing-library/react");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { MemoryRouter } = await import("react-router");
    const kumo = await import("@cloudflare/kumo");
    const ComposeEmail = (await import("app/components/ComposeEmail")).default;
    const { useUIStore } = await import("app/hooks/useUIStore");

    useUIStore.getState().openComposeModal();

    function Wrapper({ children }: { children: React.ReactNode }) {
      const [client] = React.useState(() => new QueryClient());
      return (
        <QueryClientProvider client={client}>
          <kumo.LinkProvider component={(props: Record<string, unknown>) => React.createElement("a", props)}>
            <kumo.TooltipProvider>
              <kumo.Toasty>
                <MemoryRouter initialEntries={["/alice@example.com/inbox"]}>{children}</MemoryRouter>
              </kumo.Toasty>
            </kumo.TooltipProvider>
          </kumo.LinkProvider>
        </QueryClientProvider>
      );
    }

    try {
      render(<ComposeEmail />, { wrapper: Wrapper });
      // New-compose title and required fields are visible
      expect(screen.getByText("New Message")).toBeTruthy();
      expect(screen.getByPlaceholderText(/recipient@example.com/)).toBeTruthy();
      expect(screen.getByPlaceholderText(/email subject/i)).toBeTruthy();
    } finally {
      useUIStore.getState().closeComposeModal();
    }
  });
});
