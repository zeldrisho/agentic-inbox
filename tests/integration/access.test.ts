// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";

// workers/app.ts pulls in Workers-runtime modules; stub them so the
// Access middleware logic can run under Vitest.
vi.mock("cloudflare:workers", () => ({ DurableObject: class {} }));
// app.ts re-exports MailboxDO, whose drizzle entry loads @opentelemetry/api
// (broken under native Node ESM); stub it like mailbox.test.ts does.
vi.mock("drizzle-orm/durable-sqlite", () => ({ drizzle: vi.fn(() => ({})) }));
// app.ts also re-exports EmailAgent; stub the module so its
// @cloudflare/ai-chat -> "ai" -> @opentelemetry/api chain never loads.
vi.mock("workers/agent", () => ({ EmailAgent: class {} }));
vi.mock("agents", () => ({
  routeAgentRequest: vi.fn(async () => new Response("agent-ok")),
}));
vi.mock("agents/mcp", () => ({
  McpAgent: Object.assign(
    class {
      env: unknown;
      constructor(_state: unknown, env: unknown) {
        this.env = env;
      }
    },
    { serve: vi.fn(() => ({ fetch: vi.fn(async () => new Response("mcp")) })) },
  ),
}));
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {},
}));
vi.mock("workers/mcp", () => ({ EmailMCP: { serve: vi.fn(() => ({ fetch: vi.fn() })) } }));

// jose is mocked so we control verification outcomes without a real JWKS.
const jwtVerifyMock = vi.hoisted(() => vi.fn());
vi.mock("jose", () => ({
  jwtVerify: jwtVerifyMock,
  createRemoteJWKSet: vi.fn(() => () => async () => ({})),
}));
// `ai` v6 transitively loads @opentelemetry/api whose ESM build fails under
// native Node; nothing here uses it, so stub the specifier out of the graph.
vi.mock("ai", () => ({ streamText: vi.fn(), generateText: vi.fn() }));

// React Router catch-all: lazy dynamic import never evaluated in these tests,
// but provide a virtual module in case resolution is attempted.
vi.mock("virtual:react-router/server-build", () => ({ routes: [] }));

import workerApp from "workers/app";

// The Access middleware skips validation when import.meta.env.DEV is true;
// force production semantics for these tests (env object is shared across
// modules, so mutating it here flips what workers/app.ts reads).
const originalDev = import.meta.env.DEV;
beforeEach(() => {
  (import.meta.env as { DEV: boolean }).DEV = false;
  // Fresh verification state per test: success unless overridden below.
  jwtVerifyMock.mockReset();
  jwtVerifyMock.mockResolvedValue({ payload: {} });
});
afterEach(() => {
  (import.meta.env as { DEV: boolean }).DEV = originalDev;
  vi.unstubAllEnvs();
});

function makeEnv(overrides: Record<string, unknown> = {}) {
  return {
    BUCKET: {
      head: vi.fn(async () => null),
      get: vi.fn(async () => null),
      put: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(async () => ({ objects: [], truncated: false })),
    },
    MAILBOX: { idFromName: vi.fn(), get: vi.fn() },
    EMAIL: { send: vi.fn() },
    AI: { run: vi.fn() },
    DOMAINS: "example.com",
    EMAIL_ADDRESSES: [],
    ...overrides,
  } as unknown as Record<string, unknown>;
}

async function request(env: unknown, path = "/api/v1/config", headers: Record<string, string> = {}) {
  const req = new Request(`https://app.example.com${path}`, { headers });
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
  // SAFETY: worker default export is (request, env, ctx)
  const res = await (
    workerApp as unknown as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> }
  ).fetch(req, env, ctx);
  return res;
}

describe("Cloudflare Access middleware (fail-closed)", () => {
  it("returns 500 when POLICY_AUD/TEAM_DOMAIN are not configured", async () => {
    const res = await request(makeEnv());
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Cloudflare Access must be configured");
  });

  it("returns 500 when only one of the two is configured", async () => {
    const res = await request(makeEnv({ POLICY_AUD: "aud123" }));
    expect(res.status).toBe(500);
  });

  it("returns 403 when the CF Access JWT is missing", async () => {
    const res = await request(makeEnv({ POLICY_AUD: "aud123", TEAM_DOMAIN: "https://team.example.com" }));
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Missing required CF Access JWT");
  });

  it("returns 403 for an invalid/expired token", async () => {
    jwtVerifyMock.mockRejectedValueOnce(new Error("signature mismatch"));
    const res = await request(
      makeEnv({ POLICY_AUD: "aud123", TEAM_DOMAIN: "https://team.example.com/cdn-cgi/access/certs" }),
      "/api/v1/config",
      { "cf-access-jwt-assertion": "not.a.realtoken" },
    );
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("Invalid or expired Access token");
  });

  it("forwards to the API when the JWT verifies", async () => {
    jwtVerifyMock.mockResolvedValueOnce({ payload: { sub: "user@ex.com" } });
    const res = await request(
      makeEnv({
        POLICY_AUD: "aud123",
        TEAM_DOMAIN: "https://team.example.com",
        BUCKET: {
          head: vi.fn(async () => null),
          get: vi.fn(async () => null),
          put: vi.fn(),
          delete: vi.fn(),
          list: vi.fn(async () => ({ objects: [], truncated: false })),
        },
      }),
      "/api/v1/config",
      { "cf-access-jwt-assertion": "tok" },
    );
    // Middleware passed; API answered (config endpoint -> 200)
    expect(res.status).toBe(200);
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ issuer: "https://team.example.com", audience: "aud123" }),
    );
  });

  it("uses full certs URL when TEAM_DOMAIN already includes the certs path", async () => {
    jwtVerifyMock.mockResolvedValueOnce({ payload: {} });
    await request(
      makeEnv({
        POLICY_AUD: "aud",
        TEAM_DOMAIN: "https://team.example.com/cdn-cgi/access/certs",
        BUCKET: { head: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn(), list: vi.fn() },
      }),
      "/api/v1/config",
      { "cf-access-jwt-assertion": "tok" },
    );
    // issuer derived from origin either way
    expect(jwtVerifyMock).toHaveBeenLastCalledWith(
      "tok",
      expect.anything(),
      expect.objectContaining({ issuer: "https://team.example.com" }),
    );
  });
});

describe("worker email() handler", () => {
  it("rethrows receiveEmail failures for Cloudflare retry/bounce", async () => {
    const handler = (
      workerApp as unknown as {
        email: (e: unknown, env: unknown, ctx: unknown) => Promise<void>;
      }
    ).email;
    const env = makeEnv();
    await expect(
      handler(
        { raw: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1)); c.close(); } }), rawSize: 0 },
        env,
        { waitUntil: vi.fn() },
      ),
    ).rejects.toThrow(/Invalid stream size/i);
  });
});
