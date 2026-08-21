// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Email, Folder, Mailbox, MailboxSettings, OutboundEmail } from "~/types";
import type { JsonValue } from "shared/json";

const REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  status: number;
  body: Record<string, JsonValue>;

  constructor(status: number, body: Record<string, JsonValue>) {
    // SAFETY: `body` arrives unparsed from the upstream API; `error` is a string field when present.
    super((body.error as string) || `Request failed: ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Combine caller signal (e.g. TanStack Query abort) with our timeout signal
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(url, {
      ...options,
      signal,
      headers: {
        "Content-Type": "application/json",
        // SAFETY: only string-valued headers are ever passed; widen from RequestInit's looser type.
        ...(options.headers as Record<string, string>),
      },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      // SAFETY: `res.json()` yields arbitrary API JSON; `ApiError` models it as JsonValue.
      throw new ApiError(res.status, body as Record<string, JsonValue>);
    }

    if (res.status === 204) {
      // SAFETY: a 204 response has no body; `undefined` is the resolved `T` by contract.
      return undefined as T;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // SAFETY: the JSON envelope matches the caller's expected `T` shape.
      return res.json() as Promise<T>;
    }
    // SAFETY: a non-JSON response is returned verbatim and cast to the caller's `T`.
    const blob = res.blob() as unknown;
    // SAFETY: `blob` is the verbatim response; cast it to the caller's `T`.
    return blob as T;
  } finally {
    clearTimeout(timeout);
  }
}

function get<T>(
  url: string,
  opts?: { params?: Record<string, string>; responseType?: string; signal?: AbortSignal },
) {
  const query = opts?.params ? `?${new URLSearchParams(opts.params)}` : "";
  const requestOptions: RequestInit = { method: "GET", signal: opts?.signal };
  if (opts?.responseType === "blob") {
    requestOptions.headers = { Accept: "*/*" };
  }
  return request<T>(`${url}${query}`, requestOptions);
}

function post<T>(url: string, body?: JsonValue, opts?: { signal?: AbortSignal }) {
  return request<T>(url, {
    method: "POST",
    signal: opts?.signal,
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

function put<T>(url: string, body?: JsonValue) {
  return request<T>(url, {
    method: "PUT",
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

function del<T>(url: string) {
  return request<T>(url, { method: "DELETE" });
}

// ---------- Typed response shapes ----------

interface EmailListResponse {
  emails: Email[];
  totalCount: number;
}

// ---------- API client ----------

const api = {
  // Config
  getConfig: () => get<{ domains: string[]; emailAddresses: string[] }>("/api/v1/config"),

  // Mailboxes
  listMailboxes: () => get<Mailbox[]>("/api/v1/mailboxes"),
  createMailbox: (email: string, name: string, settings?: MailboxSettings) =>
    post<Mailbox>(
      "/api/v1/mailboxes",
      settings === undefined ? { email, name } : { email, name, settings },
    ),
  getMailbox: (mailboxId: string) => get<Mailbox>(`/api/v1/mailboxes/${mailboxId}`),
  updateMailbox: (mailboxId: string, settings: MailboxSettings) =>
    put<Mailbox>(`/api/v1/mailboxes/${mailboxId}`, { settings }),
  deleteMailbox: (mailboxId: string) => del<void>(`/api/v1/mailboxes/${mailboxId}`),

  // Emails
  listEmails: (
    mailboxId: string,
    params: Record<string, string>,
    opts?: { signal?: AbortSignal },
  ) =>
    get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/emails`, {
      params,
      signal: opts?.signal,
    }),
  sendEmail: (mailboxId: string, email: OutboundEmail) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails`, email),
  getEmail: (mailboxId: string, id: string, opts?: { signal?: AbortSignal }) =>
    get<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, { signal: opts?.signal }),
  updateEmail: (mailboxId: string, id: string, data: Partial<Pick<Email, "read" | "starred">>) =>
    put<Email>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`, data),
  deleteEmail: (mailboxId: string, id: string) =>
    del<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}`),
  moveEmail: (mailboxId: string, id: string, folderId: string) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${id}/move`, { folderId }),
  getThread: (mailboxId: string, threadId: string, opts?: { signal?: AbortSignal }) =>
    get<Email[]>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}`, { signal: opts?.signal }),
  markThreadRead: (mailboxId: string, threadId: string) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/threads/${threadId}/read`),
  getAttachment: (mailboxId: string, emailId: string, attachmentId: string) =>
    get<Blob>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/attachments/${attachmentId}`, {
      responseType: "blob",
    }),
  saveDraft: (
    mailboxId: string,
    draft: {
      to?: string;
      cc?: string;
      bcc?: string;
      subject?: string;
      body: string;
      in_reply_to?: string;
      thread_id?: string;
      draft_id?: string;
    },
  ) => post<{ draft_id: string }>(`/api/v1/mailboxes/${mailboxId}/drafts`, draft),
  replyToEmail: (mailboxId: string, emailId: string, email: OutboundEmail) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/reply`, email),
  forwardEmail: (mailboxId: string, emailId: string, email: OutboundEmail) =>
    post<void>(`/api/v1/mailboxes/${mailboxId}/emails/${emailId}/forward`, email),

  // Folders
  listFolders: (mailboxId: string) => get<Folder[]>(`/api/v1/mailboxes/${mailboxId}/folders`),
  createFolder: (mailboxId: string, name: string) =>
    post<Folder>(`/api/v1/mailboxes/${mailboxId}/folders`, { name }),
  updateFolder: (mailboxId: string, id: string, name: string) =>
    put<Folder>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`, { name }),
  deleteFolder: (mailboxId: string, id: string) =>
    del<void>(`/api/v1/mailboxes/${mailboxId}/folders/${id}`),

  // Search
  searchEmails: (mailboxId: string, params: Record<string, string>) =>
    get<EmailListResponse | Email[]>(`/api/v1/mailboxes/${mailboxId}/search`, { params }),
};

export default api;
