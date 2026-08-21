// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import api, { ApiError } from "app/services/api";

function jsonResponse(body: unknown, status = 200, contentType = "application/json") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": contentType },
  });
}

/** Installs a fetch mock and records calls. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client request handling", () => {
  it("throws ApiError with server-provided message on error", async () => {
    mockFetch(() => jsonResponse({ error: "Mailbox already exists" }, 409));
    const err = await api.createMailbox("a@example.com", "A").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Mailbox already exists");
    expect(err.status).toBe(409);
    expect(err.body).toEqual({ error: "Mailbox already exists" });
  });

  it("falls back to generic message when body has no error field", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    const err = await api.listMailboxes().catch((e) => e);
    expect(err.message).toBe("Request failed: 500");
  });

  it("returns undefined for 204 responses", async () => {
    const spy = mockFetch(() => new Response(null, { status: 204 }));
    await expect(api.deleteMailbox("a@ex.com")).resolves.toBeUndefined();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com");
    expect(init.method).toBe("DELETE");
  });

  it("parses JSON responses and sets Content-Type header", async () => {
    const spy = mockFetch(() => jsonResponse({ domains: ["example.com"] }));
    await expect(api.getConfig()).resolves.toEqual({ domains: ["example.com"] });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("returns blob for non-JSON responses", async () => {
    mockFetch(
      () =>
        new Response(new Blob(["file"]), {
          status: 200,
          headers: { "Content-Type": "application/octet-stream" },
        }),
    );
    const result = await api.getAttachment("a@ex.com", "e1", "att1");
    expect(result).toBeInstanceOf(Blob);
  });

  it("propagates caller abort signals", async () => {
    const spy = mockFetch(() => jsonResponse([]));
    const controller = new AbortController();
    await api.listEmails("a@ex.com", {}, { signal: controller.signal });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeDefined();
  });

  it("rejects when fetch fails", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    await expect(api.listMailboxes()).rejects.toThrow("network down");
  });
});

describe("api endpoint URL/method/body shapes", () => {
  it("listMailboxes GETs the mailboxes collection", async () => {
    const spy = mockFetch(() => jsonResponse([]));
    await api.listMailboxes();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes");
    expect(init.method).toBe("GET");
  });

  it("createMailbox omits settings when not provided", async () => {
    const spy = mockFetch(() => jsonResponse({}, 201));
    await api.createMailbox("a@example.com", "Alice");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@example.com", name: "Alice" });
  });

  it("createMailbox includes settings when provided", async () => {
    const spy = mockFetch(() => jsonResponse({}, 201));
    await api.createMailbox("a@example.com", "Alice", { fromName: "Alice" } as never);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      email: "a@example.com",
      name: "Alice",
      settings: { fromName: "Alice" },
    });
  });

  it("getMailbox GETs the detail URL", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "a@ex.com" }));
    await api.getMailbox("a@ex.com");
    expect((spy.mock.calls[0] as unknown[])[0]).toBe("/api/v1/mailboxes/a@ex.com");
  });

  it("updateMailbox PUTs settings", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await api.updateMailbox("a@ex.com", { fromName: "X" } as never);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ settings: { fromName: "X" } });
  });

  it("listEmails encodes params as query string", async () => {
    const spy = mockFetch(() => jsonResponse({ emails: [], totalCount: 0 }));
    await api.listEmails("a@ex.com", { folder: "inbox", page: "2" });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com/emails?folder=inbox&page=2");
    expect(init.method).toBe("GET");
  });

  it("sendEmail POSTs the outbound payload", async () => {
    const spy = mockFetch(() => jsonResponse({}, 202));
    const email = { to: "b@ex.com", subject: "hi", html: "<p>hi</p>" };
    await api.sendEmail("a@ex.com", email as never);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com/emails");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(email);
  });

  it("email detail endpoints build correct URLs", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await api.getEmail("a@ex.com", "e1");
    await api.updateEmail("a@ex.com", "e1", { read: true });
    await api.deleteEmail("a@ex.com", "e1");
    await api.moveEmail("a@ex.com", "e1", "archive");
    const urls = spy.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      "/api/v1/mailboxes/a@ex.com/emails/e1",
      "/api/v1/mailboxes/a@ex.com/emails/e1",
      "/api/v1/mailboxes/a@ex.com/emails/e1",
      "/api/v1/mailboxes/a@ex.com/emails/e1/move",
    ]);
  });

  it("thread endpoints POST read receipts", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await api.markThreadRead("a@ex.com", "t1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com/threads/t1/read");
    expect(init.method).toBe("POST");
  });

  it("draft save POSTs to drafts", async () => {
    const spy = mockFetch(() => jsonResponse({ draft_id: "d1" }, 201));
    await api.saveDraft("a@ex.com", { to: "b@ex.com", body: "hello" });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com/drafts");
    expect(JSON.parse(init.body as string)).toMatchObject({ to: "b@ex.com", body: "hello" });
  });

  it("reply/forward POST to their sub-resources", async () => {
    const spy = mockFetch(() => jsonResponse({}, 202));
    const email = { to: "b@ex.com", subject: "Re: hi", html: "<p>hi</p>" };
    await api.replyToEmail("a@ex.com", "e1", email as never);
    await api.forwardEmail("a@ex.com", "e1", email as never);
    const urls = spy.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      "/api/v1/mailboxes/a@ex.com/emails/e1/reply",
      "/api/v1/mailboxes/a@ex.com/emails/e1/forward",
    ]);
  });

  it("folder endpoints build correct URLs", async () => {
    const spy = mockFetch(() => jsonResponse({}));
    await api.listFolders("a@ex.com");
    await api.createFolder("a@ex.com", "proj");
    await api.updateFolder("a@ex.com", "proj", "renamed");
    await api.deleteFolder("a@ex.com", "proj");
    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0][0]).toBe("/api/v1/mailboxes/a@ex.com/folders");
    expect(calls[1][0]).toBe("/api/v1/mailboxes/a@ex.com/folders");
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ name: "proj" });
    expect(calls[2][0]).toBe("/api/v1/mailboxes/a@ex.com/folders/proj");
    expect(calls[3][0]).toBe("/api/v1/mailboxes/a@ex.com/folders/proj");
  });

  it("searchEmails GETs the search endpoint with params", async () => {
    const spy = mockFetch(() => jsonResponse({ emails: [], totalCount: 0 }));
    await api.searchEmails("a@ex.com", { query: "pricing" });
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com/search?query=pricing");
  });

  it("getAttachment requests blob accept header", async () => {
    const spy = mockFetch(
      () =>
        new Response(new Blob(["x"]), {
          headers: { "Content-Type": "application/octet-stream" },
        }),
    );
    await api.getAttachment("a@ex.com", "e1", "att1");
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/mailboxes/a@ex.com/emails/e1/attachments/att1");
    expect((init.headers as Record<string, string>).Accept).toBe("*/*");
  });
});
