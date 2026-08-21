// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "~/services/api";
import type { Mailbox, MailboxSettings } from "~/types";
import { queryKeys } from "./keys";

/**
 * Fetches all mailboxes.
 *
 * @returns The mailbox list query result
 */
export function useMailboxes() {
  return useQuery<Mailbox[]>({
    queryKey: queryKeys.mailboxes.all,
    queryFn: () => api.listMailboxes(),
  });
}

/**
 * Fetches a mailbox by ID when an ID is provided.
 *
 * @param mailboxId - The ID of the mailbox to fetch
 * @returns The mailbox query result
 */
export function useMailbox(mailboxId: string | undefined) {
  return useQuery<Mailbox>({
    queryKey: mailboxId ? queryKeys.mailboxes.detail(mailboxId) : ["mailboxes", "_disabled"],
    queryFn: () => api.getMailbox(mailboxId!),
    enabled: !!mailboxId,
  });
}

/**
 * Provides a mutation for creating a mailbox.
 *
 * @returns A mailbox creation mutation that invalidates the mailbox list cache after success.
 */
export function useCreateMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, name }: { email: string; name: string }) =>
      api.createMailbox(email, name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
    },
  });
}

/**
 * Provides a mutation for updating mailbox settings.
 *
 * @returns A mailbox update mutation that refreshes the updated mailbox and mailbox list data after success.
 */
export function useUpdateMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mailboxId, settings }: { mailboxId: string; settings: MailboxSettings }) =>
      api.updateMailbox(mailboxId, settings),
    onSuccess: (_data, { mailboxId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(mailboxId) });
      void qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
    },
  });
}

/**
 * Provides a mutation for deleting a mailbox.
 *
 * @returns A mailbox deletion mutation.
 */
export function useDeleteMailbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mailboxId: string) => api.deleteMailbox(mailboxId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.mailboxes.all });
    },
  });
}
