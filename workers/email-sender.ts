// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending via Cloudflare Email Service binding.
 *
 * Uses the `send_email` Worker binding (`env.EMAIL.send()`) to send emails.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */

import type { ThreadingHeaders } from "./lib/email-helpers";

export interface SendEmailParams {
  to: string | string[];
  from: string | { email: string; name: string };
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | { email: string; name: string };
  attachments?: {
    content: string; // base64 encoded
    filename: string;
    type: string;
    disposition: "attachment" | "inline";
    contentId?: string;
  }[];
  headers?: ThreadingHeaders;
}

/**
 * Sends an email through the Cloudflare Email Service binding.
 *
 * @param params - Email recipients, sender, subject, body, and optional message fields
 * @returns An object containing the sent message's identifier
 */
export async function sendEmail(
  binding: SendEmail,
  params: SendEmailParams,
): Promise<{ messageId: string }> {
  const message: SendEmailParams = {
    to: params.to,
    from: params.from,
    subject: params.subject,
  };

  if (params.html) message.html = params.html;
  if (params.text) message.text = params.text;
  if (params.cc) message.cc = params.cc;
  if (params.bcc) message.bcc = params.bcc;
  if (params.replyTo) message.replyTo = params.replyTo;

  if (params.headers && Object.keys(params.headers).length > 0) {
    message.headers = params.headers;
  }

  if (params.attachments && params.attachments.length > 0) {
    message.attachments = params.attachments.map((att) => ({
      content: att.content,
      filename: att.filename,
      type: att.type,
      disposition: att.disposition,
      contentId: att.contentId,
    }));
  }

  // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
  const result = await binding.send(message as any);
  return { messageId: result.messageId };
}
