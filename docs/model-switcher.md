# Model Switcher — Workers AI + Autoroute

> Extracted from `docs/plan.md` — implementation detail for the model picker / autoroute.

## Source

- Primary live catalog: `https://developers.cloudflare.com/workers-ai/models/index.md` — fetched via Worker `GET /api/v1/models` (proxies with `Accept: text/markdown`, parses `https://developers.cloudflare.com/workers-ai/models/<slug>/` links, maps short slug → `@cf/...` via `shared/models.ts:FALLBACK_MODELS`).
- Fallback static list `shared/models.ts:FALLBACK_MODELS` used when fetch fails (`source:"fallback"`).
- Cache: `caches.default` 10s + R2 `cache/models.json` 24h, `?refresh=1` bypasses cache.

## Storage

- Per-mailbox `MailboxSettings.agentModel?: string` — `"autoroute"` sentinel or explicit `"@cf/..."`. Updated via `PUT /api/v1/mailboxes/:id` or instantly from chat sidebar.

## Autoroute (Workers AI, no AI Gateway)

- Client-side `workers-ai-provider` `fallback: { mode: "client", models: [...] }` (`workers-ai-provider/dist/index.mjs:1913` `createClientFallbackModel`).
- In `workers/agent/index.ts` both `onChatMessage` (stream) and `handleNewEmail` (batch, gated by `agentAutoDraft`) do:
  ```ts
  const modelId = await getAgentModel(env, mailboxId);
  const { primary, fallbacks } = resolveModelWithFallback(modelId); // autoroute -> DEFAULT_AGENT_MODEL + AUTOROUTE_FALLBACKS
  const model = workersai(primary, { fallback: { mode: "client", models: fallbacks } });
  ```
- Explicit picks also wrapped with same fallback chain as safety net. No `fallback.mode:"server"`, no `gateway.ai.cloudflare.com`, no `ai_gateway` binding in `wrangler.jsonc`.

## UI

- Chat sidebar `app/components/AgentPanel.tsx`: selector + refresh btn next to send (instant `PUT` + toast, next `streamText` uses new model). Header badge shows `autoroute` or short name.
- Settings no longer has picker (removed, see `app/routes/settings.tsx`).

## References

- Workers AI models catalog: <https://developers.cloudflare.com/workers-ai/models/index.md>
- Workers AI docs index: <https://developers.cloudflare.com/workers-ai/llms.txt>
- Kumo UI docs index: <https://kumo-ui.com/llms.txt>
