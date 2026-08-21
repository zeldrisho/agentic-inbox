// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect } from "vite-plus/test";
import { parseSearchQuery } from "app/lib/search-parser";

describe("parseSearchQuery", () => {
  it("parses free-text query", () => {
    expect(parseSearchQuery("hello world")).toEqual({ query: "hello world" });
  });

  it("parses from: operator", () => {
    const r = parseSearchQuery("from:alice@example.com hello");
    expect(r.from).toBe("alice@example.com");
    expect(r.query).toBe("hello");
  });

  it("parses quoted values", () => {
    const r = parseSearchQuery('from:"John Doe" subject:"Re: Hello"');
    expect(r.from).toBe("John Doe");
    expect(r.subject).toBe("Re: Hello");
    expect(r.query).toBe("");
  });

  it("parses folder, read status, and has:attachment", () => {
    const r = parseSearchQuery("in:inbox is:unread has:attachment report");
    expect(r.folder).toBe("inbox");
    expect(r.is_read).toBe(false);
    expect(r.has_attachment).toBe(true);
    expect(r.query).toBe("report");
  });

  it("parses is:starred and date operators", () => {
    const r = parseSearchQuery("is:starred after:2025-01-01 before:2025-12-31");
    expect(r.is_starred).toBe(true);
    expect(r.date_start).toBeDefined();
    expect(r.date_end).toBeDefined();
    expect(r.date_start).toContain("2025-01-01");
  });

  it("handles is:read / is:unstarred variants", () => {
    expect(parseSearchQuery("is:read").is_read).toBe(true);
    expect(parseSearchQuery("is:unstarred").is_starred).toBe(false);
  });

  it("ignores invalid dates", () => {
    const r = parseSearchQuery("after:not-a-date");
    expect(r.date_start).toBeUndefined();
  });

  it("trims extra whitespace", () => {
    const r = parseSearchQuery("  hello   from:bob  ");
    expect(r.query).toBe("hello");
    expect(r.from).toBe("bob");
  });

  it("parses to: and subject: operators", () => {
    const r = parseSearchQuery("to:carol@example.com subject:invoice");
    expect(r.to).toBe("carol@example.com");
    expect(r.subject).toBe("invoice");
  });
});
