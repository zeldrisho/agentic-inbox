// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect } from "vite-plus/test";
import { SendEmailRequestSchema } from "workers/lib/schemas";

describe("SendEmailRequestSchema", () => {
  const base = {
    to: "recipient@example.com",
    from: "sender@example.com",
    subject: "Hello",
    html: "<p>Hi</p>",
  };

  it("accepts valid html payload", () => {
    expect(() => SendEmailRequestSchema.parse(base)).not.toThrow();
  });

  it("accepts text instead of html", () => {
    const { html: _h, ...rest } = base;
    expect(() => SendEmailRequestSchema.parse({ ...rest, text: "Hi" })).not.toThrow();
  });

  it("rejects when both html and text missing", () => {
    const { html: _h, ...rest } = base;
    expect(() => SendEmailRequestSchema.parse(rest)).toThrow();
  });

  it("accepts array recipients and cc/bcc", () => {
    expect(() =>
      SendEmailRequestSchema.parse({
        ...base,
        to: ["a@ex.com", "b@ex.com"],
        cc: "cc@ex.com",
        bcc: ["bcc@ex.com"],
      }),
    ).not.toThrow();
  });

  it("accepts object from with name", () => {
    expect(() =>
      SendEmailRequestSchema.parse({
        ...base,
        from: { email: "sender@example.com", name: "Sender" },
      }),
    ).not.toThrow();
  });

  it("rejects invalid email", () => {
    expect(() => SendEmailRequestSchema.parse({ ...base, to: "not-an-email" })).toThrow();
  });

  it("accepts threading fields and attachments", () => {
    expect(() =>
      SendEmailRequestSchema.parse({
        ...base,
        in_reply_to: "msg-id",
        references: ["msg1", "msg2"],
        thread_id: "thread1",
        attachments: [
          {
            content: "base64content",
            filename: "file.pdf",
            type: "application/pdf",
            disposition: "attachment",
          },
        ],
      }),
    ).not.toThrow();
  });
});
