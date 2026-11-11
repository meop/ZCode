import type {
  CodingPlanResets,
  CodingPlanResetsResult,
  CodingPlanResetType,
  CodingPlanUsage,
  CodingPlanStatus,
  CodingPlanHistory,
  CodingPlanUsageLimit,
} from "@zcode/bootstrap";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const USAGE_TITLE = "Coding Plan usage";
const STATUS_TITLE = "Coding Plan status";
const STATS_TITLE = "Coding Plan statistics";

type FormatOptions = { now?: number; timeZone?: string };

const LABELS: Record<CodingPlanUsageLimit["kind"], string> = {
  "five-hour": "5-hour window",
  weekly: "weekly",
  "monthly-tools": "tools (month)",
  other: "other",
};

function untilTime(at: number, now: number): string {
  const ms = Math.max(0, at - now);
  if (ms >= DAY_MS) return `${Math.floor(ms / DAY_MS)}d ${Math.floor((ms % DAY_MS) / HOUR_MS)}h`;
  if (ms >= HOUR_MS)
    return `${Math.floor(ms / HOUR_MS)}h ${Math.floor((ms % HOUR_MS) / MINUTE_MS)}m`;
  return `${Math.ceil(ms / MINUTE_MS)}m`;
}

function clock(at: number, now: number, timeZone?: string): string {
  const sameDay = Math.abs(at - now) < DAY_MS;
  return new Date(at).toLocaleString("en-US", {
    ...(timeZone ? { timeZone } : {}),
    ...(sameDay ? {} : { weekday: "short", month: "short", day: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function day(at: number, timeZone?: string): string {
  return new Date(at).toLocaleDateString("en-US", {
    ...(timeZone ? { timeZone } : {}),
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const thousands = (value: number) => Math.round(value).toLocaleString("en-US");

function amount(limit: CodingPlanUsageLimit): string {
  if (limit.kind === "monthly-tools" && limit.total !== undefined)
    return `${limit.used ?? 0} / ${limit.total} calls`;
  return limit.percentage === undefined ? "--" : `${Math.round(limit.percentage)}% used`;
}

export function formatCodingPlanStatus(usage: CodingPlanStatus): string {
  const sub = usage.subscription;
  if (!sub) {
    const plan = usage.family === "zai" ? "Z.ai Coding Plan" : "BigModel Coding Plan";
    return `${STATUS_TITLE}\n${usage.level ? `${plan} (${usage.level})` : plan}`;
  }
  const parts = [sub.version ? `${sub.productName} (${sub.version})` : sub.productName];
  if (sub.billingCycle) parts.push(sub.billingCycle);
  if (sub.nextRenewTime)
    parts.push(
      sub.autoRenew === false ? `ends ${sub.nextRenewTime}` : `renews ${sub.nextRenewTime}`,
    );
  if (sub.status && sub.status !== "VALID") parts.push(sub.status.toLowerCase());
  return `${STATUS_TITLE}\n${parts.join(" · ")}`;
}

/** Only the current quotas belong in /usage. */
export function formatCodingPlanUsage(usage: CodingPlanUsage, options: FormatOptions = {}): string {
  const now = options.now ?? Date.now();
  const tz = options.timeZone;
  const order: CodingPlanUsageLimit["kind"][] = ["five-hour", "weekly", "monthly-tools", "other"];
  const rows: [string, string, string][] = [...usage.limits]
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map((limit) => [
      LABELS[limit.kind],
      amount(limit),
      limit.nextResetTime === undefined
        ? ""
        : `resets in ${untilTime(limit.nextResetTime, now)} (${clock(limit.nextResetTime, now, tz)})`,
    ]);
  if (usage.mcp)
    rows.push([
      "official MCP",
      `${usage.mcp.used} / ${usage.mcp.limit} calls`,
      usage.mcp.nextRefreshAt === undefined
        ? ""
        : `refreshes in ${untilTime(usage.mcp.nextRefreshAt, now)} (${clock(usage.mcp.nextRefreshAt, now, tz)})`,
    ]);
  const lines: string[] = [USAGE_TITLE];
  if (rows.length === 0) lines.push("No limits reported.");
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  const amountWidth = Math.max(...rows.map(([, value]) => value.length), 0);
  for (const [label, value, reset] of rows)
    lines.push(
      `${label.padEnd(width)}   ${reset ? `${value.padEnd(amountWidth)}   ${reset}` : value}`,
    );
  return lines.join("\n");
}

export const STATS_USAGE = "Usage: /stats [days] (1–30, default 7)";

export function parseStatsDays(args: string): number | undefined {
  const value = args.trim();
  if (!value) return 7;
  if (!/^\d+$/u.test(value)) return undefined;
  const days = Number(value);
  return days >= 1 && days <= 30 ? days : undefined;
}

export function formatCodingPlanStats(history: CodingPlanHistory | undefined): string {
  if (!history) return `${STATS_TITLE}\nNo usage history reported.`;
  const lines = [
    STATS_TITLE,
    `Last ${history.days} ${history.days === 1 ? "day" : "days"} · ${thousands(history.tokens)} tokens · ${thousands(history.calls)} calls`,
  ];
  if (history.models.length) {
    lines.push("", "By model");
    const width = Math.max(...history.models.map((model) => model.name.length));
    for (const model of history.models)
      lines.push(`${model.name.padEnd(width)}   ${thousands(model.tokens)} tokens`);
  }
  return lines.join("\n");
}

const RESET_KINDS: Record<string, CodingPlanResetType> = {
  "5h": "FIVE_HOUR",
  "five-hour": "FIVE_HOUR",
  hour: "FIVE_HOUR",
  week: "WEEK",
  weekly: "WEEK",
};

export type ResetCommand =
  | { action: "show" }
  | { action: "confirm" | "use"; resetType: CodingPlanResetType }
  | { action: "usage-error" };

/** `/reset`, `/reset 5h|week` to ask, `/reset 5h|week now` to spend one. */
export function parseResetCommand(args: string): ResetCommand {
  const words = args.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return { action: "show" };
  const resetType = RESET_KINDS[words[0]!];
  if (!resetType || words.length > 2 || (words[1] !== undefined && words[1] !== "now"))
    return { action: "usage-error" };
  return { action: words[1] === "now" ? "use" : "confirm", resetType };
}

export const RESET_USAGE = "Usage: /reset [5h|week] [now]";

const kindName = (type: CodingPlanResetType) => (type === "FIVE_HOUR" ? "5-hour" : "weekly");
const available = (resets: CodingPlanResets, type: CodingPlanResetType) =>
  type === "FIVE_HOUR" ? resets.fiveHour : resets.week;

export function formatCodingPlanResets(
  result: CodingPlanResetsResult,
  options: FormatOptions = {},
): string {
  const now = options.now ?? Date.now();
  const tz = options.timeZone;
  const { resets } = result;
  const row = (type: CodingPlanResetType, lastUsed?: number) => {
    const expiries = available(resets, type);
    const left =
      expiries.length === 0
        ? "none available"
        : `${expiries.length} available, next expires ${day(expiries[0]!, tz)}`;
    const last = lastUsed === undefined ? "never used" : `last used ${day(lastUsed, tz)}`;
    return `${kindName(type).padEnd(6)}   ${left} · ${last}`;
  };
  const lines = [
    "Window resets",
    row("FIVE_HOUR", resets.lastFiveHourUsedAt),
    row("WEEK", resets.lastWeekUsedAt),
  ];
  if (result.granted) lines.push("A new reset was granted just now.");
  else if (result.nextTryAt !== undefined)
    lines.push(
      `No new reset yet; eligibility is checked again in ${untilTime(result.nextTryAt, now)}.`,
    );
  if (resets.fiveHour.length + resets.week.length > 0)
    lines.push("Spend one with /reset 5h or /reset week; it clears that window.");
  return lines.join("\n");
}

export function formatResetConfirmation(
  resets: CodingPlanResets,
  type: CodingPlanResetType,
): string {
  const count = available(resets, type).length;
  if (count === 0) return `No ${kindName(type)} resets available.`;
  const arg = type === "FIVE_HOUR" ? "5h" : "week";
  return `This spends 1 of ${count} ${kindName(type)} resets and clears your ${kindName(type)} window. Run /reset ${arg} now to go ahead.`;
}

export function formatResetUsed(after: CodingPlanResets, type: CodingPlanResetType): string {
  const left = available(after, type).length;
  return `${kindName(type)[0]!.toUpperCase()}${kindName(type).slice(1)} window reset. ${left} ${kindName(type)} reset${left === 1 ? "" : "s"} left.`;
}
