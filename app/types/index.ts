// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export type SignatureSettings = {
  enabled: boolean;
  text: string;
  html?: string;
};

export type MailboxSettings = {
  fromName?: string;
  forwarding?: { enabled: boolean; email: string };
  signature?: SignatureSettings;
  autoReply?: { enabled: boolean; subject: string; message: string };
  agentSystemPrompt?: string;
};

export interface Mailbox {
  id: string;
  email: string;
  name: string;
  settings?: MailboxSettings;
}

export type Email = {
  id: string;
  thread_id?: string | null;
  folder_id?: string | null;
  subject: string;
  sender: string;
  recipient: string;
  cc?: string;
  bcc?: string;
  date: string;
  read: boolean;
  starred: boolean;
  body?: string | null;
  in_reply_to?: string | null;
  email_references?: string | null;
  message_id?: string | null;
  raw_headers?: string | null;
  attachments?: Attachment[];
  snippet?: string | null;
  // Thread aggregate fields (only present in threaded list view)
  thread_count?: number;
  thread_unread_count?: number;
  participants?: string;
  needs_reply?: boolean;
  has_draft?: boolean;
};

export type Attachment = {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
  content_id?: string;
  disposition?: string;
};

export interface Folder {
  id: string;
  name: string;
  unreadCount: number;
}

/** Outbound email payload sent to the API for send/reply/forward. */
export type OutboundEmail = {
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  from: string | { email: string; name: string };
  subject?: string;
  body?: string;
  html?: string;
  text?: string;
  in_reply_to?: string;
  thread_id?: string;
  draft_id?: string;
};
