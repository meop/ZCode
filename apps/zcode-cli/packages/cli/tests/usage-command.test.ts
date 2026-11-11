import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCodingPlanResets,
  formatCodingPlanUsage,
  formatResetConfirmation,
  formatResetUsed,
  parseResetCommand,
} from "../src/command-center/usage-command.js";

const now = Date.UTC(2026, 10, 11, 10, 0);
const H = 3_600_000;
const D = 24 * H;

test("formats the plan, its limits and the extras", () => {
  const text = formatCodingPlanUsage(
    {
      providerId: "account:zai-individual-coding-plan",
      family: "zai",
      level: "lite",
      limits: [
        { kind: "weekly", type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 2, nextResetTime: now + 3 * D + 2 * H },
        { kind: "monthly-tools", type: "TIME_LIMIT", used: 4, total: 100, nextResetTime: now + 20 * D },
        { kind: "five-hour", type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10.4, nextResetTime: now + 2 * H + 15 * 60_000 },
      ],
      subscription: { productName: "GLM Coding Lite", version: "V2", billingCycle: "annually", autoRenew: true, nextRenewTime: "2027-04-02", status: "VALID" },
      mcp: { used: 0, limit: 1000, nextRefreshAt: now + 6 * H },
      resets: { fiveHour: [], week: [now + 40 * D, now + 41 * D] },
      history: { days: 7, calls: 48, tokens: 830891, models: [{ name: "GLM-5.3", tokens: 494021 }, { name: "GLM-5.3-Flash", tokens: 336870 }] },
    },
    { now, timeZone: "UTC" },
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "GLM Coding Lite (V2) · annually · renews 2027-04-02");
  assert.match(lines[1]!, /^5-hour window\s+10% used\s+resets in 2h 15m \(12:15\)$/);
  assert.match(lines[2]!, /^weekly\s+2% used\s+resets in 3d 2h \(Sat, Nov 14, 12:00\)$/);
  assert.match(lines[3]!, /^tools \(month\)\s+4 \/ 100 calls\s+resets in 20d 0h/);
  assert.match(lines[4]!, /^official MCP\s+0 \/ 1000 calls\s+refreshes in 6h 0m \(16:00\)$/);
  assert.match(lines[5]!, /^window resets\s+5-hour none · weekly 2 \(next expires Mon, Dec 21\)\s+\(\/reset\)$/);
  assert.match(lines[6]!, /^last 7 days\s+830,891 tokens, 48 calls: GLM-5.3 494,021 · GLM-5.3-Flash 336,870$/);
});

test("falls back to the plan level without a subscription, and says when no limits come", () => {
  assert.equal(
    formatCodingPlanUsage({ providerId: "p", family: "bigmodel", level: null, limits: [] }),
    "BigModel Coding Plan\nNo limits reported.",
  );
});

test("parses /reset forms", () => {
  assert.deepEqual(parseResetCommand(""), { action: "show" });
  assert.deepEqual(parseResetCommand("week"), { action: "confirm", resetType: "WEEK" });
  assert.deepEqual(parseResetCommand("5h now"), { action: "use", resetType: "FIVE_HOUR" });
  assert.deepEqual(parseResetCommand("week later"), { action: "usage-error" });
  assert.deepEqual(parseResetCommand("month"), { action: "usage-error" });
});

test("formats resets, a confirmation, and a spent reset", () => {
  const resets = { fiveHour: [], week: [now + 40 * D], lastWeekUsedAt: now - 2 * D };
  const shown = formatCodingPlanResets({ resets, granted: false, nextTryAt: now + 30 * 60_000 }, { now, timeZone: "UTC" });
  assert.match(shown, /^Window resets\n5-hour\s+none available · never used\nweekly\s+1 available, next expires Mon, Dec 21 · last used Mon, Nov 9/);
  assert.match(shown, /eligibility is checked again in 30m/);
  assert.match(shown, /Spend one with \/reset 5h or \/reset week/);
  assert.equal(
    formatResetConfirmation(resets, "WEEK"),
    "This spends 1 of 1 weekly resets and clears your weekly window. Run /reset week now to go ahead.",
  );
  assert.equal(formatResetConfirmation(resets, "FIVE_HOUR"), "No 5-hour resets available.");
  assert.equal(formatResetUsed({ fiveHour: [], week: [] }, "WEEK"), "Weekly window reset. 0 weekly resets left.");
});
