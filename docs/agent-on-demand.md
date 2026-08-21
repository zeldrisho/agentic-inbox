# Agent — On-Demand

> Extracted from `docs/plan.md` — implementation detail for on-demand agent + sidebar default.

## Behavior

- System prompt `workers/agent/index.ts:DEFAULT_SYSTEM_PROMPT` is on-demand: `Only read/summarize/list when user asks. Ask before drafting. Never auto-draft.`
- `workers/agent/index.ts:handleNewEmail` early-returns `{ status: "skipped", reason: "auto_draft_disabled" }` when `MailboxSettings.agentAutoDraft !== true`. Defense in depth: `workers/index.ts:receiveEmail` also gates `ctx.waitUntil(agentStub.fetch(/onNewEmail))` behind R2 `mailboxes/<id>.json:agentAutoDraft === true` (default off, 0 AI calls on inbound).
- `isPromptInjection` + `verifyDraft` retained for manual drafts (`toolDraftReply(runVerifyDraft:true)`).

## Sidebar

- `app/hooks/useUIStore.ts:isAgentPanelOpen` defaults `false`, persisted to `localStorage:agentPanelOpen`. `app/routes/mailbox.tsx` conditionally mounts `AgentSidebar` only when open (saves WS + `agents/react` dynamic import).
- Toggle in `app/components/Header.tsx:RobotIcon` (desktop `hidden lg:flex`).

## Tests to add

- `receiveEmail` matrix `agentAutoDraft` true/false; `agent.test.ts` 0 AI calls when gated off; E2E asserts sidebar closed on `/mailbox/:id/emails/inbox`.

## References

- Workers AI models catalog: <https://developers.cloudflare.com/workers-ai/models/index.md>
- Workers AI docs index: <https://developers.cloudflare.com/workers-ai/llms.txt>
- Kumo UI docs index: <https://kumo-ui.com/llms.txt>
