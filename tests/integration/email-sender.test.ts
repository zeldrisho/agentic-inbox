// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi } from "vite-plus/test";
import { sendEmail } from "workers/email-sender";

function mockBinding() {
  return { send: vi.fn(async () => ({ messageId: "mid-1" })) } as unknown as SendEmail;
}

describe("sendEmail", () => {
  it("sends minimal message and returns messageId", async () => {
    const binding = mockBinding();
    const result = await sendEmail(binding, {
      to: "bob@example.com",
      from: "alice@example.com",
      subject: "Hi",
    });
    expect(result).toEqual({ messageId: "mid-1" });
    expect(binding.send).toHaveBeenCalledWith({
      to: "bob@example.com",
      from: "alice@example.com",
      subject: "Hi",
    });
  });

  it("includes optional html/text/cc/bcc/replyTo", async () => {
    const binding = mockBinding();
    await sendEmail(binding, {
      to: "bob@example.com",
      from: { email: "alice@example.com", name: "Alice" },
      subject: "Hi",
      html: "<p>Hi</p>",
      text: "Hi",
      cc: "cc@example.com",
      bcc: ["b1@example.com"],
      replyTo: "alice@example.com",
    });
    const sent = (binding.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent).toMatchObject({
      html: "<p>Hi</p>",
      text: "Hi",
      cc: "cc@example.com",
      bcc: ["b1@example.com"],
      replyTo: "alice@example.com",
    });
  });

  it("includes threading headers when provided", async () => {
    const binding = mockBinding();
    await sendEmail(binding, {
      to: "bob@example.com",
      from: "alice@example.com",
      subject: "Re: Hi",
      headers: { "In-Reply-To": "<msg-1>", References: "<msg-0> <msg-1>" },
    });
    const sent = (binding.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.headers).toEqual({ "In-Reply-To": "<msg-1>", References: "<msg-0> <msg-1>" });
  });

  it("omits headers when empty object", async () => {
    const binding = mockBinding();
    await sendEmail(binding, {
      to: "bob@example.com",
      from: "alice@example.com",
      subject: "Hi",
      headers: {},
    });
    const sent = (binding.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.headers).toBeUndefined();
  });

  it("maps attachments with disposition and contentId", async () => {
    const binding = mockBinding();
    await sendEmail(binding, {
      to: "bob@example.com",
      from: "alice@example.com",
      subject: "Hi",
      attachments: [
        {
          content: "base64",
          filename: "f.pdf",
          type: "application/pdf",
          disposition: "attachment",
          contentId: "cid-1",
        },
      ],
    });
    const sent = (binding.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sent.attachments).toEqual([
      {
        content: "base64",
        filename: "f.pdf",
        type: "application/pdf",
        disposition: "attachment",
        contentId: "cid-1",
      },
    ]);
  });
});
