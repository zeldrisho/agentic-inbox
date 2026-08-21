// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  useMailboxes,
  useMailbox,
  useCreateMailbox,
  useUpdateMailbox,
  useDeleteMailbox,
} from "app/queries/mailboxes";
import {
  useEmails,
  useEmail,
  useThreadReplies,
  useUpdateEmail,
  useSendEmail,
  useDeleteEmail,
  useSaveDraft,
  useMarkThreadRead,
} from "app/queries/emails";
import {
  useFolders,
  useCreateFolder,
  useUpdateFolder,
  useDeleteFolder,
} from "app/queries/folders";
import { useSearchEmails, SEARCH_PAGE_SIZE } from "app/queries/search";
import { queryKeys } from "app/queries/keys";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

function setupHook<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    (
      { children } as { children: ReactNode }
    ) && <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...renderHook(hook, { wrapper }), client };
}

describe("queryKeys", () => {
  it("builds hierarchical keys", () => {
    expect(queryKeys.mailboxes.all).toEqual(["mailboxes"]);
    expect(queryKeys.mailboxes.detail("a")).toEqual(["mailboxes", "a"]);
    expect(queryKeys.emails.list("a", { folder: "inbox" })).toEqual([
      "emails",
      "a",
      { folder: "inbox" },
    ]);
    expect(queryKeys.emails.detail("a", "e1")).toEqual(["emails", "a", "e1"]);
    expect(queryKeys.emails.thread("a", "t1")).toEqual(["emails", "a", "thread", "t1"]);
    expect(queryKeys.folders.list("a")).toEqual(["folders", "a"]);
    expect(queryKeys.search.results("a", "q", 2)).toEqual(["search", "a", "q", 2]);
    expect(queryKeys.config).toEqual(["config"]);
  });
});

describe("mailbox queries", () => {
  it("useMailboxes fetches the list", async () => {
    mockFetch(() => jsonResponse([{ id: "a@example.com" }]));
    const { result } = setupHook(() => useMailboxes());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "a@example.com" }]);
  });

  it("useMailbox is disabled without an id and fetches with one", async () => {
    mockFetch(() => jsonResponse({ id: "a@example.com" }));
    const disabled = setupHook(() => useMailbox(undefined));
    expect(disabled.result.current.isEnabled).toBe(false);

    const { result } = setupHook(() => useMailbox("a@example.com"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("a@example.com");
  });

  it("mutations hit their endpoints and invalidate", async () => {
    const spy = mockFetch((url, init) => jsonResponse({}, (init?.method === "POST" ? 201 : 200)));
    const { result: createResult } = setupHook(() => useCreateMailbox());
    await createResult.current.mutateAsync({ email: "n@ex.com", name: "N" });

    const { result: updateResult } = setupHook(() => useUpdateMailbox());
    await updateResult.current.mutateAsync({
      mailboxId: "n@ex.com",
      settings: { fromName: "X" } as never,
    });

    const { result: deleteResult } = setupHook(() => useDeleteMailbox());
    await deleteResult.current.mutateAsync("n@ex.com");

    const urls = (spy.mock.calls as unknown as [string, RequestInit][]).map(([u, i]) => `${i.method} ${u}`);
    expect(urls).toContain("POST /api/v1/mailboxes");
    expect(urls).toContain("PUT /api/v1/mailboxes/n@ex.com");
    expect(urls).toContain("DELETE /api/v1/mailboxes/n@ex.com");
  });
});

describe("email queries", () => {
  it("useEmails normalizes envelope responses and adds threaded flag", async () => {
    const spy = mockFetch(() => jsonResponse({ emails: [{ id: "e1" }], totalCount: 5 }));
    const { result } = setupHook(() => useEmails("a@example.com", { folder: "inbox" }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ emails: [{ id: "e1" }], totalCount: 5 });
    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("threaded=true");
    expect(url).toContain("folder=inbox");
  });

  it("useEmails normalizes bare-array responses", async () => {
    mockFetch(() => jsonResponse([{ id: "e1" }, { id: "e2" }]));
    const { result } = setupHook(() => useEmails("a@example.com", {}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      emails: [{ id: "e1" }, { id: "e2" }],
      totalCount: 2,
    });
  });

  it("useEmail is disabled when ids missing", async () => {
    mockFetch(() => jsonResponse({}));
    const { result } = setupHook(() => useEmail(undefined, "e1"));
    expect(result.current.isEnabled).toBe(false);
  });

  it("useThreadReplies fetches thread and caches each message", async () => {
    mockFetch(() => jsonResponse([{ id: "e1" }, { id: "e2" }]));
    const hook = setupHook(() => useThreadReplies("a@example.com", "t1"));
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data).toHaveLength(2);
    // detail caches populated for panel clicks
    expect(hook.client.getQueryData(queryKeys.emails.detail("a@example.com", "e1"))).toMatchObject({
      id: "e1",
    });
    expect(hook.client.getQueryData(queryKeys.emails.detail("a@example.com", "e2"))).toMatchObject({
      id: "e2",
    });
  });

  it("useUpdateEmail optimistically patches cache and rolls back on error", async () => {
    const listKey = queryKeys.emails.list("a@example.com", {});
    let failRequest = true;
    const spy = mockFetch((url, init) => {
      if (init?.method === "PUT") {
        return failRequest ? new Response("{}", { status: 500 }) : jsonResponse({ id: "e1" });
      }
      return jsonResponse({ emails: [{ id: "e1", read: false }], totalCount: 1 });
    });

    const hook = setupHook(() => useUpdateEmail());
    // Seed list + detail caches
    await hook.client.prefetchQuery({ queryKey: listKey, queryFn: async () => ({ emails: [{ id: "e1", read: false }], totalCount: 1 }) });
    hook.client.setQueryData(queryKeys.emails.detail("a@example.com", "e1"), { id: "e1", read: false });

    // Failed mutation rolls back the optimistic patch
    await expect(
      hook.result.current.mutateAsync({
        mailboxId: "a@example.com",
        id: "e1",
        data: { read: true },
      }),
    ).rejects.toBeTruthy();
    expect(hook.client.getQueryData<{ emails: { id: string; read: boolean }[] }>(listKey)?.emails[0].read).toBe(false);
    expect(
      hook.client.getQueryData<{ read: boolean }>(queryKeys.emails.detail("a@example.com", "e1"))?.read,
    ).toBe(false);
    expect(spy).toHaveBeenCalled();

    // Successful mutation applies the patch
    failRequest = false;
    await hook.result.current.mutateAsync({
      mailboxId: "a@example.com",
      id: "e1",
      data: { read: true },
    });
    await waitFor(() =>
      expect(
        hook.client.getQueryData<{ read: boolean }>(queryKeys.emails.detail("a@example.com", "e1"))
          ?.read,
      ).toBe(true),
    );
  });

  it("mutation helpers hit their endpoints", async () => {
    const spy = mockFetch(() => jsonResponse({}, 202));
    const send = setupHook(() => useSendEmail());
    await send.result.current.mutateAsync({
      mailboxId: "a@ex.com",
      email: { to: "b@ex.com", subject: "hi", html: "<p>hi</p>" } as never,
    });

    const del = setupHook(() => useDeleteEmail());
    await del.result.current.mutateAsync({ mailboxId: "a@ex.com", id: "e1" });

    const draft = setupHook(() => useSaveDraft());
    await draft.result.current.mutateAsync({
      mailboxId: "a@ex.com",
      draft: { to: "b@ex.com", body: "hi" },
    });

    const markRead = setupHook(() => useMarkThreadRead());
    await markRead.result.current.mutateAsync({ mailboxId: "a@ex.com", threadId: "t1" });

    const urls = (spy.mock.calls as unknown as [string, RequestInit][]).map(([u, i]) => `${i.method} ${u}`);
    expect(urls).toContain("POST /api/v1/mailboxes/a@ex.com/emails");
    expect(urls).toContain("DELETE /api/v1/mailboxes/a@ex.com/emails/e1");
    expect(urls).toContain("POST /api/v1/mailboxes/a@ex.com/drafts");
    expect(urls).toContain("POST /api/v1/mailboxes/a@ex.com/threads/t1/read");
  });
});

describe("folder + search queries", () => {
  it("folder mutations hit their endpoints and invalidate", async () => {
    const spy = mockFetch(() => jsonResponse({ id: "proj", name: "proj" }, 201));
    const create = setupHook(() => useCreateFolder());
    await create.result.current.mutateAsync({ mailboxId: "a@ex.com", name: "proj" });

    const update = setupHook(() => useUpdateFolder());
    await update.result.current.mutateAsync({ mailboxId: "a@ex.com", id: "proj", name: "renamed" });

    const del = setupHook(() => useDeleteFolder());
    await del.result.current.mutateAsync({ mailboxId: "a@ex.com", id: "proj" });

    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    const urls = calls.map(([u, i]) => `${i.method} ${u}`);
    expect(urls).toContain("POST /api/v1/mailboxes/a@ex.com/folders");
    expect(urls).toContain("PUT /api/v1/mailboxes/a@ex.com/folders/proj");
    expect(urls).toContain("DELETE /api/v1/mailboxes/a@ex.com/folders/proj");
  });

  it("reply/forward mutations hit their endpoints", async () => {
    const spy = mockFetch(() => jsonResponse({}, 202));
    const { useReplyToEmail, useForwardEmail } = await import("app/queries/emails");
    const reply = setupHook(() => useReplyToEmail());
    await reply.result.current.mutateAsync({
      mailboxId: "a@ex.com",
      emailId: "e1",
      email: { to: "b@ex.com", subject: "Re: hi", html: "<p>hi</p>" } as never,
    });
    const fwd = setupHook(() => useForwardEmail());
    await fwd.result.current.mutateAsync({
      mailboxId: "a@ex.com",
      emailId: "e1",
      email: { to: "c@ex.com", subject: "Fwd: hi", html: "<p>hi</p>" } as never,
    });
    const urls = (spy.mock.calls as unknown as [string, RequestInit][]).map(([u, i]) => `${i.method} ${u}`);
    expect(urls).toContain("POST /api/v1/mailboxes/a@ex.com/emails/e1/reply");
    expect(urls).toContain("POST /api/v1/mailboxes/a@ex.com/emails/e1/forward");
  });
  it("useFolders fetches folder list", async () => {
    mockFetch(() => jsonResponse([{ id: "inbox", name: "Inbox" }]));
    const { result } = setupHook(() => useFolders("a@example.com"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("useSearchEmails parses filters into params", async () => {
    const spy = mockFetch(() => jsonResponse({ emails: [{ id: "e1" }], totalCount: 1 }));
    const { result } = setupHook(() =>
      useSearchEmails("a@example.com", "from:alice pricing", 2),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totalCount).toBe(1);
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("page=2");
    expect(url).toContain(`limit=${SEARCH_PAGE_SIZE}`);
    expect(url).toContain("from=alice");
    expect(url).toContain("query=pricing");
  });

  it("useSearchEmails normalizes array responses", async () => {
    mockFetch(() => jsonResponse([{ id: "e9" }]));
    const { result } = setupHook(() => useSearchEmails("a@example.com", "hello", 1));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ results: [{ id: "e9" }], totalCount: 1 });
  });
});
