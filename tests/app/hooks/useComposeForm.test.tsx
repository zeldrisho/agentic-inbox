// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as React from "react";

const toastAdd = vi.fn();

vi.mock("@cloudflare/kumo", () => ({
  useKumoToastManager: () => ({ add: toastAdd }),
}));

vi.mock("app/queries/mailboxes", () => ({
  useMailbox: () => ({ data: mailboxData }),
}));

function makeMutation() {
  return {
    mutateAsync: vi.fn(async () => ({})),
    mutate: vi.fn(),
  };
}

const sendEmailMutation = makeMutation();
const saveDraftMutation = makeMutation();
const replyMutation = makeMutation();
const forwardMutation = makeMutation();
const deleteEmailMutation = makeMutation();

vi.mock("app/queries/emails", () => ({
  useSendEmail: () => sendEmailMutation,
  useSaveDraft: () => saveDraftMutation,
  useReplyToEmail: () => replyMutation,
  useForwardEmail: () => forwardMutation,
  useDeleteEmail: () => deleteEmailMutation,
}));

import { useComposeForm } from "app/hooks/useComposeForm";
import { useUIStore } from "app/hooks/useUIStore";

let mailboxData: Record<string, unknown> | null = {
  id: "alice@example.com",
  email: "alice@example.com",
  name: "Alice",
  settings: {},
};

const noop = () => {};
const preventDefault = () => {};

describe("useComposeForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mailboxData = {
      id: "alice@example.com",
      email: "alice@example.com",
      name: "Alice",
      settings: {},
    };
    useUIStore.getState().closeCompose();
  });

  it("blocks send when no mailbox is selected and sets the error", async () => {
    mailboxData = { data: null } as unknown as Record<string, unknown>;
    const { result } = renderHook(() => useComposeForm(undefined));
    await act(async () => {
      await result.current.handleSend({ preventDefault } as React.FormEvent, noop);
    });
    expect(result.current.error).toBe("No mailbox selected.");
    expect(sendEmailMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("blocks send when there are no recipients and sets the error", async () => {
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    await act(async () => {
      await result.current.handleSend({ preventDefault } as React.FormEvent, noop);
    });
    expect(result.current.error).toBe("Add at least one recipient.");
    expect(sendEmailMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("routes reply mode through the reply mutation using the original email id", async () => {
    useUIStore.setState({
      composeOptions: {
        mode: "reply",
        originalEmail: { id: "e1", subject: "Hi", sender: "bob@example.com", recipient: "me", date: "", body: "", read: true, starred: false },
        draftEmail: null,
      },
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    act(() => result.current.setTo("bob@example.com"));
    let closed = false;
    await act(async () => {
      await result.current.handleSend({ preventDefault } as React.FormEvent, () => {
        closed = true;
      });
    });
    expect(replyMutation.mutateAsync).toHaveBeenCalled();
    expect(sendEmailMutation.mutateAsync).not.toHaveBeenCalled();
    expect(closed).toBe(true);
  });

  it("routes forward mode through the forward mutation", async () => {
    useUIStore.setState({
      composeOptions: {
        mode: "forward",
        originalEmail: { id: "e2", subject: "Hi", sender: "a@x.com", recipient: "b@x.com", date: "", body: "", read: true, starred: false },
        draftEmail: null,
      },
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    act(() => result.current.setTo("c@x.com"));
    await act(async () => {
      await result.current.handleSend({ preventDefault } as React.FormEvent, noop);
    });
    expect(forwardMutation.mutateAsync).toHaveBeenCalled();
    expect(sendEmailMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("deletes the draft after sending a draft edit and closes the panel", async () => {
    useUIStore.setState({
      composeOptions: {
        mode: "new",
        originalEmail: null,
        draftEmail: {
          id: "d1",
          sender: "alice@example.com",
          recipient: "bob@example.com",
          date: new Date().toISOString(),
          subject: "s",
          body: "b",
          read: true,
          starred: false,
        },
      },
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    let closed = false;
    await act(async () => {
      await result.current.handleSend({ preventDefault } as React.FormEvent, () => {
        closed = true;
      });
    });
    expect(sendEmailMutation.mutateAsync).toHaveBeenCalled();
    expect(deleteEmailMutation.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ mailboxId: "alice@example.com", id: "d1" }),
    );
    expect(closed).toBe(true);
  });

  it("surfaces Error messages from a failed send", async () => {
    sendEmailMutation.mutateAsync = vi.fn(async () => {
      throw new Error("SMTP exploded");
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    act(() => result.current.setTo("bob@example.com"));
    await act(async () => {
      await result.current.handleSend({ preventDefault } as React.FormEvent, noop);
    });
    expect(result.current.error).toBe("SMTP exploded");
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(result.current.isSending).toBe(false);
  });

  it("falls back to a generic message when a non-Error value is thrown on send", async () => {
    sendEmailMutation.mutateAsync = vi.fn(async () => {
      throw "just a string";
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    act(() => result.current.setTo("bob@example.com"));
    await act(async () => {
      await result.current.handleSend({ preventDefault } as React.FormEvent, noop);
    });
    expect(result.current.error).toBe("Failed to send email.");
  });

  it("skips saving a draft when no mailbox is set", async () => {
    const { result } = renderHook(() => useComposeForm(undefined));
    await act(async () => {
      await result.current.handleSaveDraft();
    });
    expect(saveDraftMutation.mutateAsync).not.toHaveBeenCalled();
    expect(result.current.isSavingDraft).toBe(false);
  });

  it("shows an error toast when saving fails and resets isSavingDraft", async () => {
    saveDraftMutation.mutateAsync = vi.fn(async () => {
      throw new Error("disk full");
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    await act(async () => {
      await result.current.handleSaveDraft();
    });
    expect(result.current.error).toBe("disk full");
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(result.current.isSavingDraft).toBe(false);
  });

  it("initializes fields for reply-all by deduplicating participants against self", () => {
    useUIStore.setState({
      composeOptions: {
        mode: "reply-all",
        originalEmail: {
          id: "e1",
          subject: "Re: Hello",
          sender: "BOB@example.com",
          recipient: "alice@example.com, carol@example.com",
          cc: "carol@example.com, alice@example.com, dave@example.com",
          date: "",
          body: "",
          read: true,
          starred: false,
        },
        draftEmail: null,
      },
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    // Bob once in To; Carol dedup'd across to/cc; Alice excluded; Dave only in CC.
    expect(result.current.to).toBe("BOB@example.com, carol@example.com");
    expect(result.current.cc).toBe("dave@example.com");
    expect(result.current.showCcBcc).toBe(true);
    expect(result.current.subject).toBe("Re: Hello");
    expect(result.current.formTitle).toBe("Reply All");
  });

  it("prefills from an edited draft including cc/bcc visibility", () => {
    useUIStore.setState({
      composeOptions: {
        mode: "new",
        originalEmail: null,
        draftEmail: {
          id: "d1",
          recipient: "bob@example.com",
          cc: "carol@example.com",
          bcc: "",
          subject: "Draft subject",
          body: "Draft body",
          sender: "alice@example.com", date: new Date().toISOString(), read: true, starred: false, },
      },
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    expect(result.current.formTitle).toBe("Edit Draft");
    expect(result.current.to).toBe("bob@example.com");
    expect(result.current.cc).toBe("carol@example.com");
    expect(result.current.showCcBcc).toBe(true);
    expect(result.current.subject).toBe("Draft subject");
    expect(result.current.body).toBe("Draft body");
  });

  it("adds a Fwd prefix for forwards without one", () => {
    useUIStore.setState({
      composeOptions: {
        mode: "forward",
        originalEmail: { id: "e3", subject: "Hello", sender: "a@x.com", recipient: "b@x.com", date: "", body: "", read: true, starred: false },
        draftEmail: null,
      },
    });
    const { result } = renderHook(() => useComposeForm("alice@example.com"));
    expect(result.current.subject).toBe("Fwd: Hello");
    expect(result.current.body).toContain("Forwarded message:");
  });
});
