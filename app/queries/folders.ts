// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Folder } from "~/types";
import { queryKeys } from "./keys";

/**
 * Fetches the folders for a mailbox.
 *
 * @param mailboxId - The mailbox identifier; when omitted, the query is disabled.
 * @returns The query result containing the mailbox's folders
 */
export function useFolders(mailboxId: string | undefined) {
  return useQuery<Folder[]>({
    queryKey: mailboxId ? queryKeys.folders.list(mailboxId) : ["folders", "_disabled"],
    // SAFETY: the casted value's invariant holds at this boundary (validated upstream or guaranteed by the call contract).
    queryFn: () => api.listFolders(mailboxId!) as Promise<Folder[]>,
    enabled: !!mailboxId,
  });
}

/**
 * Provides a mutation for creating a folder in a mailbox.
 *
 * @returns A folder-creation mutation.
 */
export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mailboxId, name }: { mailboxId: string; name: string }) =>
      api.createFolder(mailboxId, name),
    onSuccess: (_data, { mailboxId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
    },
  });
}

/**
 * Provides a mutation for updating a mailbox folder and refreshing its folder list.
 *
 * @returns A folder update mutation
 */
export function useUpdateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mailboxId, id, name }: { mailboxId: string; id: string; name: string }) =>
      api.updateFolder(mailboxId, id, name),
    onSuccess: (_data, { mailboxId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
    },
  });
}

/**
 * Provides a mutation for deleting a mailbox folder.
 *
 * @returns A folder-deletion mutation that refreshes the mailbox's folder list after success.
 */
export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mailboxId, id }: { mailboxId: string; id: string }) =>
      api.deleteFolder(mailboxId, id),
    onSuccess: (_data, { mailboxId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.folders.list(mailboxId) });
    },
  });
}
