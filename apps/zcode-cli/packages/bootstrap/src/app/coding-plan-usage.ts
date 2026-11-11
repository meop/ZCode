/* Coding Plan account information for the standalone CLI's /usage and /reset, read from the
   endpoints the desktop app's usage panel uses (services usage-stats/bigmodelUsageQuotaProvider.ts,
   bigmodelSubscriptionProvider.ts, zcodeMcpQuotaProvider.ts):

   - quota limits: the 5-hour and weekly token windows and the monthly tool calls
   - the subscription: plan name, version, billing cycle, renewal
   - official MCP calls against their limit
   - window resets: those granted, asking the server to judge eligibility first as the desktop
     app does, and spending one
   - the last 7 days' tokens by model

   The quota, subscription and history take the request credential the model calls use, bare,
   so none costs a login exchange; resets and MCP take the ZCode JWT with the platform JWT. */
import { randomUUID } from "node:crypto";
import { createMcpTransportFetch } from "@zcode/adapters";
import {
  createSharedZCodeCredentialStore,
  isZaiPlatformToken,
  type SharedZCodeCredentialStore,
} from "@zcode/adapters/auth";
import { createConfig } from "@zcode/adapters/config";
import { createRootTraceContext } from "@zcode/contracts";
import type { ProviderRuntimeHeadersPort } from "@zcode/core";
import {
  buildBigModelApiUrl,
  buildRuntimeZaiBusinessUrl,
  buildRuntimeZCodeApiUrl,
  type ZCodeProviderAccountAccess,
} from "@zcode/shared";
import { resolveStandaloneOfficialHeaders } from "./standalone-official-auth.js";

const QUOTA_PATH = "/api/monitor/usage/quota/limit";
const RESET_PATH = "/api/v1/coding-plan/reset";
const REQUEST_TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;

type Family = "zai" | "bigmodel";

export interface CodingPlanUsageLimit {
  /** five-hour and weekly token windows, monthly tool calls, or a limit this client doesn't name */
  readonly kind: "five-hour" | "weekly" | "monthly-tools" | "other";
  readonly type: string;
  readonly unit?: number;
  readonly number?: number;
  /** share used, 0 to 100 */
  readonly percentage?: number;
  readonly used?: number;
  readonly total?: number;
  /** epoch milliseconds */
  readonly nextResetTime?: number;
}

export interface CodingPlanSubscription {
  readonly productName: string;
  readonly version?: string;
  readonly billingCycle?: string;
  readonly status?: string;
  readonly autoRenew?: boolean;
  /** YYYY-MM-DD, as the server gives it */
  readonly nextRenewTime?: string;
}

export interface CodingPlanResets {
  /** expiry of each reset granted and not yet used, epoch milliseconds */
  readonly fiveHour: readonly number[];
  readonly week: readonly number[];
  readonly lastFiveHourUsedAt?: number;
  readonly lastWeekUsedAt?: number;
}

export interface CodingPlanHistory {
  readonly days: number;
  readonly calls: number;
  readonly tokens: number;
  readonly models: readonly { readonly name: string; readonly tokens: number }[];
}

export interface CodingPlanUsage {
  readonly providerId: string;
  readonly family: Family;
  readonly level: string | null;
  readonly limits: readonly CodingPlanUsageLimit[];
  /** each absent when its endpoint gave nothing usable; the rest still show */
  readonly subscription?: CodingPlanSubscription;
  readonly mcp?: { readonly used: number; readonly limit: number; readonly nextRefreshAt?: number };
  readonly resets?: CodingPlanResets;
  readonly history?: CodingPlanHistory;
}

export type CodingPlanResetType = "FIVE_HOUR" | "WEEK";

interface UsageRuntime {
  readonly runtime: {
    readonly registryService: {
      getSnapshot(): {
        readonly registry: {
          readonly providers: readonly { readonly providerId: string; readonly config: unknown }[];
        };
      } | null;
    };
  };
  readonly providerRuntimeHeadersPort?: ProviderRuntimeHeadersPort;
}

export interface CodingPlanAccountInput {
  runtime: UsageRuntime | undefined;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof globalThis.fetch;
  store?: Pick<SharedZCodeCredentialStore, "loadMany">;
  abortSignal?: AbortSignal;
  now?: () => number;
}

const TOKEN_LIMIT_TYPES = new Set(["TOKENS_LIMIT", "CREDIT_LIMIT"]);

/** The desktop app's reading of the units: 3 with number 5 is the 5-hour window, 6 the week. */
function limitKind(type: string, unit?: number, number?: number): CodingPlanUsageLimit["kind"] {
  if (TOKEN_LIMIT_TYPES.has(type) && unit === 3 && number === 5) return "five-hour";
  if (TOKEN_LIMIT_TYPES.has(type) && unit === 6) return "weekly";
  if (type === "TIME_LIMIT") return "monthly-tools";
  return "other";
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

/** The envelope's data, or an error with the server's message; the APIs use 0 or 200 for success. */
function envelopeData(payload: unknown, what: string): Record<string, unknown> {
  const envelope = payload as { code?: unknown; msg?: unknown; data?: unknown } | null;
  if (!envelope || ![0, 200, "0", "200"].includes(envelope.code as number))
    throw new Error(`${what} failed: ${str(envelope?.msg) ?? "unknown error"}`);
  return (envelope.data ?? {}) as Record<string, unknown>;
}

export function parseCodingPlanQuota(
  payload: unknown,
): Pick<CodingPlanUsage, "level" | "limits"> {
  const data = envelopeData(payload, "Coding Plan usage request");
  const limits = (Array.isArray(data.limits) ? data.limits : []).flatMap((raw) => {
    const limit = raw as Record<string, unknown>;
    if (typeof limit?.type !== "string") return [];
    const unit = num(limit.unit);
    const number = num(limit.number);
    const used = num(limit.currentValue);
    const total = num(limit.usage);
    const percentage = num(limit.percentage);
    const nextResetTime = num(limit.nextResetTime);
    return [
      {
        kind: limitKind(limit.type, unit, number),
        type: limit.type,
        ...(unit !== undefined ? { unit } : {}),
        ...(number !== undefined ? { number } : {}),
        ...(percentage !== undefined ? { percentage } : {}),
        ...(used !== undefined ? { used } : {}),
        ...(total !== undefined ? { total } : {}),
        ...(nextResetTime !== undefined ? { nextResetTime } : {}),
      },
    ];
  });
  return { level: typeof data.level === "string" ? data.level : null, limits };
}

/** The plan in its current period, as the desktop app picks it from the list. */
export function parseCodingPlanSubscription(payload: unknown): CodingPlanSubscription | undefined {
  const list = envelopeData(payload, "Subscription request") as unknown;
  const entries = (Array.isArray(list) ? list : []) as Record<string, unknown>[];
  const current =
    entries.find((entry) => entry.inCurrentPeriod === true && entry.status === "VALID") ??
    entries.find((entry) => entry.status === "VALID") ??
    entries[0];
  const productName = str(current?.productName);
  if (!current || !productName) return undefined;
  const version = str(current.version);
  const billingCycle = str(current.billingCycle);
  const status = str(current.status);
  const nextRenewTime = str(current.nextRenewTime);
  return {
    productName,
    ...(version ? { version } : {}),
    ...(billingCycle ? { billingCycle } : {}),
    ...(status ? { status } : {}),
    ...(typeof current.autoRenew === "number" || typeof current.autoRenew === "boolean"
      ? { autoRenew: Boolean(current.autoRenew) }
      : {}),
    ...(nextRenewTime ? { nextRenewTime } : {}),
  };
}

export function parseCodingPlanResets(payload: unknown): CodingPlanResets {
  const data = envelopeData(payload, "Reset status request");
  const expiries = (value: unknown) =>
    (Array.isArray(value) ? value : [])
      .map((item) => num((item as { expire_at?: unknown })?.expire_at))
      .filter((at): at is number => at !== undefined)
      .sort((a, b) => a - b);
  const usedAt = (value: unknown) => num((value as { used_at?: unknown } | null)?.used_at);
  const lastFiveHourUsedAt = usedAt(data.latest_five_hour_reset_history);
  const lastWeekUsedAt = usedAt(data.latest_week_reset_history);
  return {
    fiveHour: expiries(data.available_five_hour_resets),
    week: expiries(data.available_week_resets),
    ...(lastFiveHourUsedAt !== undefined ? { lastFiveHourUsedAt } : {}),
    ...(lastWeekUsedAt !== undefined ? { lastWeekUsedAt } : {}),
  };
}

export function parseCodingPlanHistory(payload: unknown, days: number): CodingPlanHistory | undefined {
  const data = envelopeData(payload, "Usage history request");
  const total = (data.totalUsage ?? {}) as Record<string, unknown>;
  const tokens = num(total.totalTokensUsage);
  if (tokens === undefined) return undefined;
  const models = (Array.isArray(total.modelSummaryList) ? total.modelSummaryList : [])
    .map((raw) => raw as Record<string, unknown>)
    .flatMap((model) => {
      const name = str(model.modelName);
      const modelTokens = num(model.totalTokens);
      return name && modelTokens !== undefined ? [{ name, tokens: modelTokens }] : [];
    })
    .sort((a, b) => b.tokens - a.tokens);
  return { days, calls: num(total.totalModelCallCount) ?? 0, tokens, models };
}

function individualPlanProvider(
  runtime: UsageRuntime,
): { providerId: string; access: ZCodeProviderAccountAccess } | undefined {
  const providers = runtime.runtime.registryService.getSnapshot()?.registry.providers ?? [];
  for (const provider of providers) {
    const access = (provider.config as { access?: ZCodeProviderAccountAccess } | null)?.access;
    if (access?.type === "zhipu-account" && access.mode === "individual-coding-plan")
      return { providerId: provider.providerId, access };
  }
  return undefined;
}

/** "YYYY-MM-DD HH:mm:ss" in local time, the monitor API's range format. */
function monitorTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Everything the account endpoints need, resolved once per command. */
async function accountContext(input: CodingPlanAccountInput) {
  const env = input.env ?? process.env;
  const port = input.runtime?.providerRuntimeHeadersPort;
  const plan = input.runtime ? individualPlanProvider(input.runtime) : undefined;
  if (!port || !plan) throw new Error("No personal Coding Plan is signed in. Use /login first.");
  const family = plan.access.accountType;
  if (family !== "zai" && family !== "bigmodel")
    throw new Error(`Usage is not available for ${plan.providerId}.`);
  const doFetch =
    input.fetch ?? createMcpTransportFetch({ env, network: createConfig({ env }).config.network });
  const store = input.store ?? createSharedZCodeCredentialStore({ env });
  const signal = () =>
    input.abortSignal
      ? AbortSignal.any([input.abortSignal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
      : AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const getJson = async (url: string, init: RequestInit = {}): Promise<unknown> => {
    const response = await doFetch(url, { ...init, signal: signal() });
    const body = await response.json().catch(() => null);
    if (!response.ok && !body) throw new Error(`HTTP ${response.status}`);
    return body;
  };
  const business = (path: string) =>
    family === "zai" ? buildRuntimeZaiBusinessUrl(env, path) : buildBigModelApiUrl(env, path);
  const requestCredential = async (): Promise<string> => {
    const auth = await port.refreshBeforeModelRequest({
      providerId: plan.providerId,
      modelId: "usage",
      accountAccess: plan.access,
      reason: "model-request",
      sessionId: "usage" as never,
      traceContext: createRootTraceContext(),
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    const credential = auth.requestAuth?.apiKey?.trim();
    if (!credential) throw new Error("The Coding Plan gave no request credential.");
    return credential;
  };
  /** The reset API's identity: the ZCode JWT, and the platform JWT bare, personal scope. */
  const resetHeaders = async (): Promise<Record<string, string>> => {
    const tokenKey = `oauth:${family}:access_token`;
    const values = await store.loadMany(["zcodejwttoken", tokenKey]);
    const jwt = values.zcodejwttoken?.trim();
    const platform = values[tokenKey]?.trim();
    if (!jwt || !platform || (family === "zai" && !isZaiPlatformToken(platform)))
      throw new Error("Resets need a current login. Use /login first.");
    return {
      Authorization: /^Bearer\s/i.test(jwt) ? jwt : `Bearer ${jwt}`,
      "X-Bigmodel-Authorization": platform,
      "Bigmodel-Target-Type": "PERSONAL",
    };
  };
  return {
    env,
    family,
    plan,
    store,
    getJson,
    business,
    requestCredential,
    resetHeaders,
    now: input.now ?? Date.now,
  };
}

type AccountContext = Awaited<ReturnType<typeof accountContext>>;

async function fetchResets(ctx: AccountContext): Promise<CodingPlanResets> {
  return parseCodingPlanResets(
    await ctx.getJson(buildRuntimeZCodeApiUrl(ctx.env, `${RESET_PATH}/status`), {
      headers: await ctx.resetHeaders(),
    }),
  );
}

export async function readCodingPlanUsage(input: CodingPlanAccountInput): Promise<CodingPlanUsage> {
  const ctx = await accountContext(input);
  const credential = await ctx.requestCredential();
  // the monitor and subscription APIs take the credential as is, without a Bearer prefix
  const withCredential = { headers: { authorization: credential } };
  const end = new Date(ctx.now());
  end.setHours(23, 59, 59, 0);
  const start = new Date(end.getTime() - 6 * DAY_MS);
  start.setHours(0, 0, 0, 0);
  const range = `startTime=${encodeURIComponent(monitorTime(start))}&endTime=${encodeURIComponent(monitorTime(end))}`;
  const optional = <T>(promise: Promise<T>) => promise.catch(() => undefined);
  const [quota, subscription, mcp, resets, history] = await Promise.all([
    ctx.getJson(ctx.business(QUOTA_PATH), withCredential),
    optional(
      ctx
        .getJson(ctx.business("/api/biz/subscription/list"), withCredential)
        .then(parseCodingPlanSubscription),
    ),
    optional(
      (async () => {
        const headers = await resolveStandaloneOfficialHeaders(ctx.store, "mcp-server");
        if (!headers.ok) return undefined;
        const data = envelopeData(
          await ctx.getJson(buildRuntimeZCodeApiUrl(ctx.env, "/api/v1/mcp/usage"), {
            headers: headers.headers,
          }),
          "MCP usage request",
        );
        const total = (data.total_usage ?? {}) as Record<string, unknown>;
        const used = num(total.used);
        const limit = num(total.limit);
        const refresh = num(data.next_refresh_at);
        return used === undefined || limit === undefined
          ? undefined
          : { used, limit, ...(refresh !== undefined ? { nextRefreshAt: refresh * 1000 } : {}) };
      })(),
    ),
    optional(fetchResets(ctx)),
    optional(
      ctx
        .getJson(ctx.business(`/api/monitor/usage/model-usage?${range}`), withCredential)
        .then((payload) => parseCodingPlanHistory(payload, 7)),
    ),
  ]);
  const { level, limits } = parseCodingPlanQuota(quota);
  return {
    providerId: ctx.plan.providerId,
    family: ctx.family,
    level,
    limits,
    ...(subscription ? { subscription } : {}),
    ...(mcp ? { mcp } : {}),
    ...(resets ? { resets } : {}),
    ...(history ? { history } : {}),
  };
}

export interface CodingPlanResetsResult {
  readonly resets: CodingPlanResets;
  /** whether the server granted a new reset just now; undefined when it was not asked */
  readonly granted?: boolean;
  /** when the server will judge eligibility again, epoch milliseconds */
  readonly nextTryAt?: number;
}

/**
 * The granted resets, after asking the server to judge eligibility: /status only lists resets
 * already granted, and the server grants new ones only when asked, as the desktop app does on
 * each look. One request covers both kinds; a denial carries when to ask again.
 */
export async function readCodingPlanResets(
  input: CodingPlanAccountInput,
): Promise<CodingPlanResetsResult> {
  const ctx = await accountContext(input);
  let granted: boolean | undefined;
  let nextTryAt: number | undefined;
  try {
    const payload = (await ctx.getJson(buildRuntimeZCodeApiUrl(ctx.env, `${RESET_PATH}/opportunity`), {
      method: "POST",
      headers: { ...(await ctx.resetHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: randomUUID() }),
    })) as { code?: unknown; data?: { granted?: unknown; next_try_at?: unknown } } | null;
    if (payload?.code === 3301) {
      granted = false;
      const at = num(payload.data?.next_try_at);
      if (at !== undefined) nextTryAt = at;
    } else if (payload?.code === 0 || payload?.code === 200) {
      granted = payload.data?.granted === true;
    }
  } catch {
    // eligibility is best effort; the granted resets still show
  }
  return {
    resets: await fetchResets(ctx),
    ...(granted !== undefined ? { granted } : {}),
    ...(nextTryAt !== undefined ? { nextTryAt } : {}),
  };
}

/** Spends one granted reset of the kind given, clearing that window; returns the resets after. */
export async function useCodingPlanReset(
  input: CodingPlanAccountInput & { resetType: CodingPlanResetType },
): Promise<CodingPlanResets> {
  const ctx = await accountContext(input);
  envelopeData(
    await ctx.getJson(buildRuntimeZCodeApiUrl(ctx.env, `${RESET_PATH}/use`), {
      method: "POST",
      headers: { ...(await ctx.resetHeaders()), "content-type": "application/json" },
      body: JSON.stringify({ idempotency_key: randomUUID(), reset_type: input.resetType }),
    }),
    "Reset",
  );
  return await fetchResets(ctx);
}
