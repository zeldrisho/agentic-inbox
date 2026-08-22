// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vite-plus/test";
import {
  formatBytes,
  splitEmailList,
  toEmailListValue,
  htmlToPlainText,
  stripHtml,
  getSnippetText,
  escapeHtml,
  getSignatureBlock,
  buildQuotedReplyBlock,
  rewriteInlineImages,
  getNonInlineAttachments,
  getAttachmentUrl,
  downloadFile,
} from "app/lib/utils";

describe("formatBytes", () => {
  it("formats zero and common sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(1073741824)).toBe("1 GB");
  });

  it("respects decimals", () => {
    expect(formatBytes(1536, 0)).toBe("2 KB");
    expect(formatBytes(1536, 2)).toBe("1.5 KB");
  });
});

describe("splitEmailList", () => {
  it("splits comma-separated emails and trims", () => {
    expect(splitEmailList("a@ex.com, b@ex.com")).toEqual(["a@ex.com", "b@ex.com"]);
    expect(splitEmailList(" a@ex.com , b@ex.com ")).toEqual(["a@ex.com", "b@ex.com"]);
  });

  it("returns empty for empty/undefined", () => {
    expect(splitEmailList("")).toEqual([]);
    expect(splitEmailList(undefined)).toEqual([]);
    expect(splitEmailList(null)).toEqual([]);
  });
});

describe("toEmailListValue", () => {
  it("returns undefined for empty, string for single, array for multiple", () => {
    expect(toEmailListValue([])).toBeUndefined();
    expect(toEmailListValue(["a@ex.com"])).toBe("a@ex.com");
    expect(toEmailListValue(["a@ex.com", "b@ex.com"])).toEqual(["a@ex.com", "b@ex.com"]);
  });
});

describe("htmlToPlainText", () => {
  it("converts block elements to line breaks and strips tags", () => {
    expect(htmlToPlainText("<p>Hello</p><p>World</p>")).toBe("Hello\n\nWorld");
    expect(htmlToPlainText("<div>line1</div><div>line2</div>")).toBe("line1\nline2");
    expect(htmlToPlainText("a<br>b")).toBe("a\nb");
  });

  it("strips script and style content", () => {
    expect(htmlToPlainText("<script>alert(1)</script>hello")).toBe("hello");
    expect(htmlToPlainText("<style>.x{}</style>hello")).toBe("hello");
  });

  it("returns empty for empty input", () => {
    expect(htmlToPlainText("")).toBe("");
  });
});

describe("stripHtml", () => {
  it("strips all tags and normalizes whitespace", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(stripHtml("<p>  multiple   spaces </p>")).toBe("multiple spaces");
  });

  it("removes script content", () => {
    expect(stripHtml("<script>alert(1)</script>hello")).toBe("hello");
  });
});

describe("getSnippetText", () => {
  it("returns empty for empty input", () => {
    expect(getSnippetText("")).toBe("");
    expect(getSnippetText(null)).toBe("");
    expect(getSnippetText(undefined)).toBe("");
  });

  it("strips tags and decodes entities", () => {
    expect(getSnippetText("<p>Hello &amp; welcome</p>")).toBe("Hello & welcome");
    expect(getSnippetText("&lt;tag&gt;")).toBe("<tag>");
  });

  it("truncates with ellipsis beyond maxLength", () => {
    const long = "a".repeat(150);
    expect(getSnippetText(long, 100)).toBe(`${"a".repeat(100)}...`);
    expect(getSnippetText("short", 100)).toBe("short");
  });
});

describe("escapeHtml", () => {
  it("escapes OWASP characters", () => {
    expect(escapeHtml(`<a href="x">&'test`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;test");
    expect(escapeHtml("")).toBe("");
  });
});

describe("getSignatureBlock", () => {
  it("returns empty when no signature", () => {
    expect(getSignatureBlock()).toBe("");
    expect(getSignatureBlock({})).toBe("");
    expect(getSignatureBlock({ signature: { enabled: false } })).toBe("");
  });

  it("returns sanitized html signature when enabled", () => {
    const block = getSignatureBlock({
      signature: { enabled: true, html: "<b>Alice</b><script>alert(1)</script>" },
    });
    expect(block).toContain("<b>Alice</b>");
    expect(block).not.toContain("<script>");
    expect(block).toContain("border-top");
  });

  it("returns escaped text signature when enabled", () => {
    const block = getSignatureBlock({ signature: { enabled: true, text: "<Alice>" } });
    expect(block).toContain("&lt;Alice&gt;");
  });
});

describe("buildQuotedReplyBlock", () => {
  it("returns empty for empty body", () => {
    expect(buildQuotedReplyBlock("2026-01-01", "bob@ex.com", "")).toBe("");
  });

  it("escapes sender and sanitizes body", () => {
    const block = buildQuotedReplyBlock(
      "2026-01-01T00:00:00.000Z",
      "Evil <evil@ex.com>",
      "<script>alert(1)</script><p>Hi there</p>",
    );
    expect(block).not.toContain("<script>");
    expect(block).toContain("&lt;evil@ex.com&gt;");
    expect(block).toContain("Hi there");
    expect(block).toContain("<blockquote");
  });
});

describe("rewriteInlineImages", () => {
  it("rewrites cid references to attachment URLs", () => {
    const body = '<img src="cid:img1">';
    const result = rewriteInlineImages(body, "alice@ex.com", "e1", [
      { id: "att1", content_id: "<img1>", disposition: "inline" },
    ]);
    expect(result).toBe(
      '<img src="/api/v1/mailboxes/alice@ex.com/emails/e1/attachments/att1">',
    );
  });

  it("returns body unchanged when no inline attachments", () => {
    const body = '<img src="cid:img1">';
    expect(rewriteInlineImages(body, "a", "e1", undefined)).toBe(body);
    expect(rewriteInlineImages(body, "a", "e1", [])).toBe(body);
    expect(
      rewriteInlineImages(body, "a", "e1", [{ id: "att1", content_id: null, disposition: "attachment" }]),
    ).toBe(body);
  });
});

describe("getNonInlineAttachments", () => {
  it("filters out inline attachments", () => {
    const atts = [
      { id: "1", disposition: "inline" },
      { id: "2", disposition: "attachment" },
    ] as Parameters<typeof getNonInlineAttachments>[0];
    expect(getNonInlineAttachments(atts)).toEqual([{ id: "2", disposition: "attachment" }]);
  });

  it("returns empty for undefined", () => {
    expect(getNonInlineAttachments(undefined)).toEqual([]);
  });
});

describe("getAttachmentUrl", () => {
  it("builds attachment API URL", () => {
    expect(getAttachmentUrl("alice@ex.com", "e1", "att1")).toBe(
      "/api/v1/mailboxes/alice@ex.com/emails/e1/attachments/att1",
    );
  });
});

describe("downloadFile", () => {
  it("creates and clicks an anchor element", () => {
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") {
        el.click = () => clicks.push((el as HTMLAnchorElement).href);
      }
      return el;
    }) as typeof document.createElement);
    downloadFile("/api/v1/file", "file.pdf");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toContain("/api/v1/file");
    spy.mockRestore();
  });
});
