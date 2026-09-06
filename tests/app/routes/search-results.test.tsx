// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect } from "vite-plus/test";
import { highlightTerms } from "app/routes/search-results";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function renderHtml(node: React.ReactNode): string {
  return renderToStaticMarkup(createElement("div", null, node));
}

describe("highlightTerms unicode offsets", () => {
  it("highlights both İ characters without empty marks", () => {
    const html = renderHtml(highlightTerms("İİ", "İ"));
    const marks = html.match(/<mark[^>]*>(.*?)<\/mark>/g) ?? [];
    expect(marks).toHaveLength(2);
    for (const mark of marks) {
      const inner = mark.replace(/<\/?mark[^>]*>/g, "");
      expect(inner).toBe("İ");
      expect(inner.length).toBeGreaterThan(0);
    }
  });

  it("still highlights ASCII case-insensitively", () => {
    const html = renderHtml(highlightTerms("Hello World", "hello"));
    expect(html).toContain("<mark");
    expect(html).toContain("Hello");
  });
});
