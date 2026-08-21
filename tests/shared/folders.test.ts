// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect } from "vite-plus/test";
import { Folders, FOLDER_DISPLAY_NAMES, getFolderDisplayName, SYSTEM_FOLDER_IDS } from "shared/folders";

describe("folders", () => {
  it("defines canonical folder IDs", () => {
    expect(Folders.INBOX).toBe("inbox");
    expect(Folders.SENT).toBe("sent");
    expect(Folders.DRAFT).toBe("draft");
    expect(Folders.ARCHIVE).toBe("archive");
    expect(Folders.TRASH).toBe("trash");
    expect(Folders.SPAM).toBe("spam");
  });

  it("SYSTEM_FOLDER_IDS excludes spam and preserves order", () => {
    expect(SYSTEM_FOLDER_IDS).toEqual(["inbox", "sent", "draft", "archive", "trash"]);
  });

  it("getFolderDisplayName returns known names", () => {
    expect(getFolderDisplayName("inbox")).toBe("Inbox");
    expect(getFolderDisplayName("INBOX")).toBe("Inbox");
    expect(getFolderDisplayName("draft")).toBe("Drafts");
  });

  it("getFolderDisplayName capitalizes unknown folders", () => {
    expect(getFolderDisplayName("custom")).toBe("Custom");
    expect(getFolderDisplayName("myFolder")).toBe("MyFolder");
  });

  it("FOLDER_DISPLAY_NAMES covers all folder IDs", () => {
    for (const id of Object.values(Folders)) {
      expect(FOLDER_DISPLAY_NAMES[id]).toBeTruthy();
    }
  });
});
