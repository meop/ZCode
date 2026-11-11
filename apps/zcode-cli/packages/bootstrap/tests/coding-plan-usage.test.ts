import { describe, expect, it, vi } from "vitest";
import {
  parseCodingPlanHistory,
  parseCodingPlanQuota,
  parseCodingPlanResets,
  parseCodingPlanSubscription,
  readCodingPlanResets,
  readCodingPlanUsage,
  readCodingPlanStatus,
  readCodingPlanStats,
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
      {
        type: "TIME_LIMIT",
        unit: 5,
        number: 1,
        usage: 100,
        currentValue: 3,
        percentage: 3,
        nextResetTime: 3,
      },
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

function runtime(
  access: object | undefined = {
    type: "zhipu-account",
    accountType: "zai",
    entitled: true,
    mode: "individual-coding-plan",
  },
) {
  return {
    runtime: {
      registryService: {
        getSnapshot: () => ({
          registry: {
            providers: [
              { providerId: "custom:x", config: { access: { type: "api-key" } } },
              ...(access
                ? [{ providerId: "account:zai-individual-coding-plan", config: { access } }]
                : []),
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
        {
          kind: "five-hour",
          type: "TOKENS_LIMIT",
          unit: 3,
          number: 5,
          percentage: 10,
          nextResetTime: 1,
        },
        {
          kind: "weekly",
          type: "TOKENS_LIMIT",
          unit: 6,
          number: 1,
          percentage: 2,
          nextResetTime: 2,
        },
        {
          kind: "monthly-tools",
          type: "TIME_LIMIT",
          unit: 5,
          number: 1,
          percentage: 3,
          used: 3,
          total: 100,
          nextResetTime: 3,
        },
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
    expect(parseCodingPlanResets(resets)).toEqual({
      fiveHour: [],
      week: [20, 30],
      lastWeekUsedAt: 5,
    });
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
    const usage = await readCodingPlanUsage({
      runtime: runtime(),
      env: {},
      fetch: fetch as never,
      store,
    });
    expect(usage).toMatchObject({
      level: "lite",
      mcp: { used: 4, limit: 1000, nextRefreshAt: 7000 },
    });
    const headers = (path: string) =>
      (
        fetch.mock.calls.find(([url]) => new URL(url).pathname === path) as unknown as [
          string,
          RequestInit,
        ]
      )[1].headers;
    expect(headers("/api/monitor/usage/quota/limit")).toEqual({ authorization: "project-token" });
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname).sort()).toEqual([
      "/api/monitor/usage/quota/limit",
      "/api/v1/mcp/usage",
    ]);
  });

  it("still shows the limits when the extras fail", async () => {
    const fetch = server({ "/api/monitor/usage/quota/limit": quota });
    const usage = await readCodingPlanUsage({
      runtime: runtime(),
      env: {},
      fetch: fetch as never,
      store,
    });
    expect(usage.limits).toHaveLength(4);
    expect(usage.mcp).toBeUndefined();
  });

  it("asks for a login when no personal plan is configured", async () => {
    await expect(
      readCodingPlanUsage({ runtime: runtime(null as never), env: {}, store }),
    ).rejects.toThrow("/login");
  });

  it("asks the server to judge eligibility before listing resets, and passes on when to ask again", async () => {
    const fetch = server({
      "/api/v1/coding-plan/reset/opportunity": {
        code: 3301,
        data: { granted: false, next_try_at: 99 },
      },
      "/api/v1/coding-plan/reset/status": resets,
    });
    const result = await readCodingPlanResets({
      runtime: runtime(),
      env: {},
      fetch: fetch as never,
      store,
    });
    expect(result).toEqual({
      resets: { fiveHour: [], week: [20, 30], lastWeekUsedAt: 5 },
      granted: false,
      nextTryAt: 99,
    });
    expect(new URL(fetch.mock.calls[0]![0]).pathname).toBe("/api/v1/coding-plan/reset/opportunity");
  });

  it("spends a reset of the kind asked, with a fresh idempotency key", async () => {
    const fetch = server({
      "/api/v1/coding-plan/reset/use": { code: 0, data: { used: true } },
      "/api/v1/coding-plan/reset/status": resets,
    });
    await useCodingPlanReset({
      runtime: runtime(),
      env: {},
      fetch: fetch as never,
      store,
      resetType: "WEEK",
    });
    const body = JSON.parse(
      String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.reset_type).toBe("WEEK");
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("refuses resets when the stored Z.ai token is not yet the platform JWT", async () => {
    const oauthStore = {
      loadMany: async (keys: readonly string[]) =>
        Object.fromEntries(
          keys.map((key) => [
            key,
            key === "zcodejwttoken"
              ? "zcode-jwt"
              : key === "oauth:zai:access_token"
                ? jwt({ client_id: "x" })
                : null,
          ]),
        ),
    };
    await expect(
      useCodingPlanReset({
        runtime: runtime(),
        env: {},
        fetch: server({}) as never,
        store: oauthStore,
        resetType: "WEEK",
      }),
    ).rejects.toThrow("/login");
  });
});

it("reads status independently from limits and history", async () => {
  const fetch = server({ "/api/biz/subscription/list": subscription });
  const result = await readCodingPlanStatus({
    runtime: runtime(),
    env: {},
    fetch: fetch as never,
    store,
  });
  expect(result.subscription?.productName).toBe("GLM Coding Lite");
  expect(fetch.mock.calls).toHaveLength(1);
});
it("reads only history with an inclusive local calendar range", async () => {
  const fetch = server({ "/api/monitor/usage/model-usage": history });
  const now = new Date(2026, 10, 11, 10).getTime();
  const input = { runtime: runtime(), env: {}, fetch: fetch as never, store, now: () => now };
  expect((await readCodingPlanStats(input))?.tokens).toBe(830891);
  const range = new URL(fetch.mock.calls[0]![0]).searchParams;
  expect(range.get("startTime")).toBe("2026-11-05 00:00:00");
  expect(range.get("endTime")).toBe("2026-11-11 23:59:59");
  await readCodingPlanStats({ ...input, days: 14 });
  expect(new URL(fetch.mock.calls[1]![0]).searchParams.get("startTime")).toBe(
    "2026-10-29 00:00:00",
  );
  expect(
    fetch.mock.calls.every(([url]) => new URL(url).pathname === "/api/monitor/usage/model-usage"),
  ).toBe(true);
  await expect(readCodingPlanStats({ ...input, days: 0 })).rejects.toThrow("1–30");
  const failed = server({ "/api/monitor/usage/model-usage": { code: 401, msg: "expired" } });
  await expect(readCodingPlanStats({ ...input, fetch: failed as never })).rejects.toThrow(
    "expired",
  );
});
it("ignores hourly series and keeps top-level model summaries", () => {
  const parsed = parseCodingPlanHistory(
    {
      code: 200,
      data: {
        totalUsage: { totalTokensUsage: 50 },
        modelSummaryList: [{ modelName: "m", totalTokens: 50 }],
        x_time: ["a", "b"],
        tokensUsage: [50],
        modelCallCount: [2, 0],
        granularity: "hour",
      },
    },
    1,
  );
  expect(parsed).toEqual({ days: 1, calls: 0, tokens: 50, models: [{ name: "m", tokens: 50 }] });
  expect(parseCodingPlanHistory({ code: 200, data: {} }, 7)).toBeUndefined();
});
