# REST API Reference

The Hono API (`workers/index.ts`) serves `/api/v1/...`. All routes sit behind the global Cloudflare Access middleware (see `docs/security-invariants.md`); routes under `/mailboxes/:mailboxId/*` additionally require the mailbox to exist (`requireMailbox`). Unless noted, requests and responses are JSON. Every request must carry a valid Cloudflare Access JWT in `cf-access-jwt-assertion` (missing/invalid → `403`); `DOMAINS`/`EMAIL_ADDRESSES` mismatches return `403`, Zod validation failures `400`, and missing mailboxes/emails `404`. Pagination on list/search endpoints: `page` (default `1`), `limit` (default `20`, max `100`).

## Examples

```bash
# Create mailbox
curl -H "cf-access-jwt-assertion: $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"hello@example.com","name":"Hello"}' \
  https://inbox.example.com/api/v1/mailboxes

# Send email (202 on success)
curl -H "cf-access-jwt-assertion: $TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"bob@example.com","subject":"Hi","body":"Hello"}' \
  https://inbox.example.com/api/v1/mailboxes/hello@example.com/emails
```

## Config

| Method | Path             | Description                                                               |
| ------ | ---------------- | ------------------------------------------------------------------------- |
| `GET`  | `/api/v1/config` | Returns `{ domains, emailAddresses }` from `DOMAINS` / `EMAIL_ADDRESSES`. |

## Mailboxes

| Method   | Path                           | Description                                                                                                                                                                                        |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/mailboxes`            | List all mailboxes (R2 `mailboxes/*.json`).                                                                                                                                                        |
| `POST`   | `/api/v1/mailboxes`            | Create a mailbox. Body: `{ email, name, settings? }`. Respects `EMAIL_ADDRESSES` allowlist (`403` if blocked, `409` if exists).                                                                    |
| `GET`    | `/api/v1/mailboxes/:mailboxId` | Get mailbox settings.                                                                                                                                                                              |
| `PUT`    | `/api/v1/mailboxes/:mailboxId` | Replace mailbox settings. Body: `{ settings }`.                                                                                                                                                    |
| `DELETE` | `/api/v1/mailboxes/:mailboxId` | Full deletion cascade (`404` if missing): wipes the mailbox DO's emails/attachments, deletes R2 attachment blobs, best-effort destroys the agent DO (chat history), and removes the settings blob. |

## Emails

| Method   | Path                                              | Description                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/mailboxes/:mailboxId/emails`             | List emails. Query: `folder`, `thread_id`, `threaded`, `page`, `limit`, `sortColumn`, `sortDirection`. Returns `{ emails, totalCount }` when filtered.                                                                      |
| `POST`   | `/api/v1/mailboxes/:mailboxId/emails`             | Send an email. Body validated by `SendEmailRequestSchema`. Validates sender, rate-limits, stores attachments, writes to `MailboxDO`, and defers delivery via the `EMAIL` binding. Returns `{ id, status: "sent" }` (`202`). |
| `GET`    | `/api/v1/mailboxes/:mailboxId/emails/:id`         | Get one email (`404` if missing).                                                                                                                                                                                           |
| `PUT`    | `/api/v1/mailboxes/:mailboxId/emails/:id`         | Update flags. Body: `{ read?, starred? }`.                                                                                                                                                                                  |
| `DELETE` | `/api/v1/mailboxes/:mailboxId/emails/:id`         | Delete an email and its R2 attachment blobs (`404` if missing).                                                                                                                                                             |
| `POST`   | `/api/v1/mailboxes/:mailboxId/emails/:id/move`    | Move to a folder. Body: `{ folderId }`.                                                                                                                                                                                     |
| `POST`   | `/api/v1/mailboxes/:mailboxId/emails/:id/reply`   | Reply helper (`workers/routes/reply-forward.ts`).                                                                                                                                                                           |
| `POST`   | `/api/v1/mailboxes/:mailboxId/emails/:id/forward` | Forward helper.                                                                                                                                                                                                             |

## Drafts

| Method | Path                                  | Description                                                                                                                                            |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST` | `/api/v1/mailboxes/:mailboxId/drafts` | Save a draft. Body: `{ to?, cc?, bcc?, subject?, body, in_reply_to?, thread_id?, draft_id? }`. If `draft_id` is set, the old draft is deleted (`201`). |

## Threads

| Method | Path                                                  | Description              |
| ------ | ----------------------------------------------------- | ------------------------ |
| `GET`  | `/api/v1/mailboxes/:mailboxId/threads/:threadId`      | List emails in a thread. |
| `POST` | `/api/v1/mailboxes/:mailboxId/threads/:threadId/read` | Mark a thread read.      |

## Folders

| Method   | Path                                       | Description                                                                                   |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/mailboxes/:mailboxId/folders`     | List folders.                                                                                 |
| `POST`   | `/api/v1/mailboxes/:mailboxId/folders`     | Create a folder. Body: `{ name }` (slugified; `400` if no alphanumerics, `409` if duplicate). |
| `PUT`    | `/api/v1/mailboxes/:mailboxId/folders/:id` | Rename a folder (`404` if missing).                                                           |
| `DELETE` | `/api/v1/mailboxes/:mailboxId/folders/:id` | Delete a folder (`400` if not found / not deletable).                                         |

## Search

| Method | Path                                  | Description                                                                                                                                                                               |
| ------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/mailboxes/:mailboxId/search` | Search emails. Query: `query`, `folder`, `from`, `to`, `subject`, `date_start`, `date_end`, `is_read`, `is_starred`, `has_attachment`, `page`, `limit`. Returns `{ emails, totalCount }`. |

## Attachments

| Method | Path                                                                     | Description                                                                                  |
| ------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId` | Download an attachment. Filename is sanitized into `Content-Disposition` (`404` if missing). |

## MCP

| Method | Path             | Description                                                                                                               |
| ------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ALL`  | `/mcp`, `/mcp/*` | Model Context Protocol server (`EmailMCP`) exposing the same email tools to external AI apps. See `docs/architecture.md`. |

## Notes

- Request bodies are validated with Zod (`workers/lib/schemas.ts` and inline schemas in `workers/index.ts`); invalid input returns `400`.
- `POST /mailboxes/:id/emails` is `202` (`{id, status:"sent"}`) — delivery is deferred via `executionCtx.waitUntil(EMAIL.send)`; auto-draft (when `agentAutoDraft` is on) is also deferred. Other writes are `200`/`201`.
- No rate-limit headers are exposed; a `429` may be returned by the send path under load — retry with backoff.
