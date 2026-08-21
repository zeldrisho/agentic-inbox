// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect } from "vite-plus/test";
import {
  validateSender,
  SenderValidationError,
  generateMessageId,
  buildThreadingHeaders,
  buildReferencesChain,
  escapeHtml,
  textToHtml,
  stripHtmlToText,
  buildQuotedReplyBlock,
} from "workers/lib/email-helpers";

describe("validateSender", () => {
  it("lowercases and validates matching sender", () => {
    const { toStr, fromEmail, fromDomain } = validateSender(
      "To@Example.com",
      "Alice@Example.com",
      "alice@example.com",
    );
    expect(toStr).toBe("to@example.com");
    expect(fromEmail).toBe("alice@example.com");
    expect(fromDomain).toBe("example.com");
  });

  it("handles array to and object from", () => {
    const { toStr } = validateSender(
      ["a@ex.com", "b@ex.com"],
      { email: "alice@ex.com", name: "Alice" },
      "alice@ex.com",
    );
    expect(toStr).toBe("a@ex.com, b@ex.com");
  });

  it("throws when from does not match mailbox", () => {
    expect(() => validateSender("a@ex.com", "evil@ex.com", "alice@ex.com")).toThrow(
      SenderValidationError,
    );
  });

  it("throws for invalid sender domain", () => {
    expect(() => validateSender("a@ex.com", "invalid", "invalid")).toThrow(SenderValidationError);
  });
});

describe("generateMessageId", () => {
  it("generates uuid and outgoing id with domain", () => {
    const { messageId, outgoingMessageId } = generateMessageId("example.com");
    expect(messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(outgoingMessageId).toBe(`${messageId}@example.com`);
  });
});

describe("buildThreadingHeaders", () => {
  it("builds In-Reply-To only when no references", () => {
    expect(buildThreadingHeaders("msg1", [])).toEqual({ "In-Reply-To": "<msg1>" });
  });

  it("builds References chain", () => {
    expect(buildThreadingHeaders("msg3", ["msg1", "msg2"])).toEqual({
      "In-Reply-To": "<msg3>",
      References: "<msg1> <msg2>",
    });
  });
});

describe("buildReferencesChain", () => {
  it("uses message_id and merges references", () => {
    const email = {
      id: "id1",
      message_id: "mid1",
      email_references: JSON.stringify(["mid0"]),
      thread_id: "thread1",
    } as unknown as Parameters<typeof buildReferencesChain>[0];
    const { originalMsgId, references, threadId } = buildReferencesChain(email);
    expect(originalMsgId).toBe("mid1");
    expect(references).toEqual(["mid0", "mid1"]);
    expect(threadId).toBe("thread1");
  });

  it("falls back to id when message_id missing and handles malformed JSON", () => {
    const email = {
      id: "id1",
      message_id: null,
      email_references: "not-json",
      thread_id: null,
    } as unknown as Parameters<typeof buildReferencesChain>[0];
    const { originalMsgId, references, threadId } = buildReferencesChain(email);
    expect(originalMsgId).toBe("id1");
    expect(references).toEqual(["id1"]);
    expect(threadId).toBe("id1");
  });
});

describe("escapeHtml / textToHtml / stripHtmlToText", () => {
  it("escapes OWASP characters", () => {
    expect(escapeHtml(`<a href="x">&'test`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;test");
    expect(escapeHtml("")).toBe("");
  });

  it("converts plain text to html with breaks", () => {
    expect(textToHtml("hello\nworld")).toBe(
      '<div style="white-space:pre-wrap">hello<br>world</div>',
    );
    expect(textToHtml("")).toBe("");
  });

  it("strips style/script and tags", () => {
    expect(
      stripHtmlToText("<style>.x{}</style><script>alert(1)</script><p>Hello <b>world</b></p>"),
    ).toBe("Hello world");
    expect(stripHtmlToText("")).toBe("");
    expect(stripHtmlToText("<p>  multiple   spaces </p>")).toBe("multiple spaces");
  });
});

describe("buildQuotedReplyBlock", () => {
  it("returns empty for missing body", () => {
    expect(buildQuotedReplyBlock({})).toBe("");
  });

  it("escapes sender and sanitizes body", () => {
    const block = buildQuotedReplyBlock({
      sender: "Evil <evil@ex.com>",
      date: "2025-01-01T00:00:00.000Z",
      body: "<script>alert(1)</script><p>Hi there</p>",
    });
    expect(block).not.toContain("<script>");
    expect(block).toContain("&lt;evil@ex.com&gt;");
    expect(block).toContain("Hi there");
    expect(block).toContain("<blockquote");
  });
});
