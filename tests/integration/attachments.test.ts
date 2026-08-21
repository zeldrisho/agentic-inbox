// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi } from "vite-plus/test";
import { storeAttachments } from "workers/lib/attachments";

function mockBucket() {
  const store = new Map<string, Uint8Array>();
  return {
    put: vi.fn(async (key: string, value: Uint8Array) => {
      store.set(key, value);
    }),
    _store: store,
  };
}

describe("storeAttachments", () => {
  it("returns empty array when no attachments", async () => {
    const bucket = mockBucket();
    expect(await storeAttachments(bucket as unknown as R2Bucket, "email-1", undefined)).toEqual([]);
    expect(await storeAttachments(bucket as unknown as R2Bucket, "email-1", [])).toEqual([]);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("decodes base64, sanitizes filename, and stores under per-email key", async () => {
    const bucket = mockBucket();
    const content = Buffer.from("hello world").toString("base64");
    const result = await storeAttachments(bucket as unknown as R2Bucket, "email-1", [
      {
        content,
        filename: 'report "final".pdf',
        type: "application/pdf",
        disposition: "attachment",
      },
    ]);
    expect(result).toHaveLength(1);
    const att = result[0];
    expect(att.email_id).toBe("email-1");
    // quotes are sanitized to underscores
    expect(att.filename).toBe("report _final_.pdf");
    expect(att.mimetype).toBe("application/pdf");
    expect(att.disposition).toBe("attachment");
    expect(att.size).toBe(11);
    expect(att.content_id).toBeNull();
    const key = [...bucket._store.keys()][0];
    expect(key).toMatch(/^attachments\/email-1\/[0-9a-f-]+\/report _final_\.pdf$/);
    expect(new TextDecoder().decode(bucket._store.get(key))).toBe("hello world");
  });

  it("sanitizes path traversal characters in filename", async () => {
    const bucket = mockBucket();
    const content = Buffer.from("x").toString("base64");
    const result = await storeAttachments(bucket as unknown as R2Bucket, "email-1", [
      {
        content,
        filename: "../../etc/passwd",
        type: "text/plain",
        disposition: "attachment",
      },
    ]);
    expect(result[0].filename).not.toContain("/");
    expect(result[0].filename).not.toContain("\\");
    // slashes replaced with underscores so no directory traversal is possible
    expect(result[0].filename).toBe(".._.._etc_passwd");
  });

  it("defaults empty filename to untitled", async () => {
    const bucket = mockBucket();
    const content = Buffer.from("x").toString("base64");
    const result = await storeAttachments(bucket as unknown as R2Bucket, "email-1", [
      {
        content,
        filename: "",
        type: "text/plain",
        disposition: "inline",
        contentId: "<cid-1>",
      },
    ]);
    expect(result[0].filename).toBe("untitled");
    expect(result[0].content_id).toBe("<cid-1>");
    expect(result[0].disposition).toBe("inline");
  });
});
