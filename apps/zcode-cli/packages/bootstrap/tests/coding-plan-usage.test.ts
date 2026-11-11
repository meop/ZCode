import { describe, expect, it, vi } from "vitest";
import {
  parseCodingPlanHistory,
  parseCodingPlanQuota,
  parseCodingPlanResets,
  parseCodingPlanSubscription,
  readCodingPlanResets,
  readCodingPlanUsage,
  useCodingPlanReset,
} from "../src/app/coding-plan-usage.js";

const jwt = (claims: object) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const platform = jwt({ user_id: "user-1" });

const quota = {
  code: 200,
  data: {
    level: "lite",
    limits: [
      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10, nextResetTime: 1 },
      { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 2, nextResetTime: 2 },
      { type: "TIME_LIMIT", unit: 5, number: 1, usage: 100, currentValue: 3, percentage: 3, nextResetTime: 3 },
      { type: "SOMETHING_NEW", percentage: 50 },
    ],
  },
};
const subscription = {
  code: 200,
  data: [
    { productName: "Old", status: "EXPIRED" },
    {
      productName: "GLM Coding Lite",
      version: "V2",
      status: "VALID",
      inCurrentPeriod: true,
      billingCycle: "annually",
      autoRenew: 1,
      nextRenewTime: "2027-04-02",
    },
  ],
};
const resets = {
  code: 0,
  data: {
    available_five_hour_resets: [],
    available_week_resets: [{ expire_at: 30 }, { expire_at: 20 }],
    latest_five_hour_reset_history: null,
    latest_week_reset_history: { used_at: 5 },
    has_unread_history: false,
  },
};
const mcp = { code: 0, data: { next_refresh_at: 7, total_usage: { used: 4, limit: 1000 } } };
const history = {
  code: 200,
  data: {
    totalUsage: {
      totalModelCallCount: 48,
      totalTokensUsage: 830891,
      modelSummaryList: [
        { modelName: "GLM-5.3-Flash", totalTokens: 336870 },
        { modelName: "GLM-5.3", totalTokens: 494021 },
      ],
    },
  },
};

const store = {
  loadMany: async (keys: readonly string[]) => {
    const values: Record<string, string> = {
      "oauth:active_provider": "zai",
      zcodejwttoken: "zcode-jwt",
      "oauth:zai:access_token": platform,
      "oauth:zai:user_info": JSON.stringify({ user_id: "user-1" }),
      "account-provider:account:zai-individual-coding-plan:identity": "user-1",
    };
    return Object.fromEntries(keys.map((key) => [key, values[key] ?? null]));
  },
};

function runtime(access: object | undefined = {
  type: "zhipu-account",
  accountType: "zai",
  entitled: true,
  mode: "individual-coding-plan",
}) {
  return {
    runtime: {
      registryService: {
        getSnapshot: () => ({
          registry: {
            providers: [
              { providerId: "custom:x", config: { access: { type: "api-key" } } },
              ...(access ? [{ providerId: "account:zai-individual-coding-plan", config: { access } }] : []),
            ],
          },
        }),
      },
    },
    providerRuntimeHeadersPort: {
      refreshBeforeModelRequest: vi.fn(async () => ({
        headersApplied: true,
        requestAuth: { apiKey: "project-token" },
      })),
    },
  };
}

function server(routes: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    const body = routes[path];
    return body === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(body), { status: 200 });
  });
}

describe("Coding Plan usage", () => {
  it("names the 5-hour, weekly and monthly-tool limits as the desktop app reads them", () => {
    expect(parseCodingPlanQuota(quota)).toEqual({
      level: "lite",
      limits: [
        { kind: "five-hour", type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10, nextResetTime: 1 },
        { kind: "weekly", type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 2, nextResetTime: 2 },
        { kind: "monthly-tools", type: "TIME_LIMIT", unit: 5, number: 1, percentage: 3, used: 3, total: 100, nextResetTime: 3 },
        { kind: "other", type: "SOMETHING_NEW", percentage: 50 },
      ],
    });
  });

  it("rejects an error envelope with the server's message", () => {
    expect(() => parseCodingPlanQuota({ code: 1001, msg: "no plan" })).toThrow("no plan");
  });

  it("picks the subscription in its current period", () => {
    expect(parseCodingPlanSubscription(subscription)).toEqual({
      productName: "GLM Coding Lite",
      version: "V2",
      status: "VALID",
      billingCycle: "annually",
      autoRenew: true,
      nextRenewTime: "2027-04-02",
    });
  });

  it("orders granted resets by expiry and keeps the last use", () => {
    expect(parseCodingPlanResets(resets)).toEqual({ fiveHour: [], week: [20, 30], lastWeekUsedAt: 5 });
  });

  it("sums the history's models, largest first", () => {
    expect(parseCodingPlanHistory(history, 7)).toEqual({
      days: 7,
      calls: 48,
      tokens: 830891,
      models: [
        { name: "GLM-5.3", tokens: 494021 },
        { name: "GLM-5.3-Flash", tokens: 336870 },
      ],
    });
  });

  it("reads every part, each with the identity its API takes", async () => {
    const fetch = server({
      "/api/monitor/usage/quota/limit": quota,
      "/api/biz/subscription/list": subscription,
      "/api/v1/mcp/usage": mcp,
      "/api/v1/coding-plan/reset/status": resets,
      "/api/monitor/usage/model-usage": history,
    });
    const usage = await readCodingPlanUsage({ runtime: runtime(), env: {}, fetch: fetch as never, store });
    expect(usage).toMatchObject({
      level: "lite",
      subscription: { productName: "GLM Coding Lite" },
      mcp: { used: 4, limit: 1000, nextRefreshAt: 7000 },
      resets: { week: [20, 30] },
      history: { tokens: 830891 },
    });
    const headers = (path: string) =>
      (fetch.mock.calls.find(([url]) => new URL(url).pathname === path) as unknown as [string, RequestInit])[1]
        .headers;
    expect(headers("/api/monitor/usage/quota/limit")).toEqual({ authorization: "project-token" });
    expect(headers("/api/v1/coding-plan/reset/status")).toEqual({
      Authorization: "Bearer zcode-jwt",
      "X-Bigmodel-Authorization": platform,
      "Bigmodel-Target-Type": "PERSONAL",
    });
  });

  it("still shows the limits when the extras fail", async () => {
    const fetch = server({ "/api/monitor/usage/quota/limit": quota });
    const usage = await readCodingPlanUsage({ runtime: runtime(), env: {}, fetch: fetch as never, store });
    expect(usage.limits).toHaveLength(4);
    expect(usage.subscription ?? usage.mcp ?? usage.resets ?? usage.history).toBeUndefined();
  });

  it("asks for a login when no personal plan is configured", async () => {
    await expect(readCodingPlanUsage({ runtime: runtime(null as never), env: {}, store })).rejects.toThrow(
      "/login",
    );
  });

  it("asks the server to judge eligibility before listing resets, and passes on when to ask again", async () => {
    const fetch = server({
      "/api/v1/coding-plan/reset/opportunity": { code: 3301, data: { granted: false, next_try_at: 99 } },
      "/api/v1/coding-plan/reset/status": resets,
    });
    const result = await readCodingPlanResets({ runtime: runtime(), env: {}, fetch: fetch as never, store });
    expect(result).toEqual({ resets: { fiveHour: [], week: [20, 30], lastWeekUsedAt: 5 }, granted: false, nextTryAt: 99 });
    expect(new URL(fetch.mock.calls[0]![0]).pathname).toBe("/api/v1/coding-plan/reset/opportunity");
  });

  it("spends a reset of the kind asked, with a fresh idempotency key", async () => {
    const fetch = server({
      "/api/v1/coding-plan/reset/use": { code: 0, data: { used: true } },
      "/api/v1/coding-plan/reset/status": resets,
    });
    await useCodingPlanReset({ runtime: runtime(), env: {}, fetch: fetch as never, store, resetType: "WEEK" });
    const body = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.reset_type).toBe("WEEK");
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("refuses resets when the stored Z.ai token is not yet the platform JWT", async () => {
    const oauthStore = {
      loadMany: async (keys: readonly string[]) =>
        Object.fromEntries(
          keys.map((key) => [
            key,
            key === "zcodejwttoken" ? "zcode-jwt" : key === "oauth:zai:access_token" ? jwt({ client_id: "x" }) : null,
          ]),
        ),
    };
    await expect(
      useCodingPlanReset({ runtime: runtime(), env: {}, fetch: server({}) as never, store: oauthStore, resetType: "WEEK" }),
    ).rejects.toThrow("/login");
  });
});
