import { expect, it } from "vitest";
import { McpResourceSubscriptionRegistry } from "../src/mcp/resource-subscriptions.js";

it("releases retired server containers under subscription churn", () => {
  const registry = new McpResourceSubscriptionRegistry();
  for (let server = 0; server < 1000; server++) {
    const name = `server-${server}`;
    const registration = registry.begin(name, "test://resource", "session|subscriber");
    registration.commit();
    expect(registry.remove(name, "test://resource", "session|subscriber")).toEqual({ last: true });
    expect(registry.counts()).toEqual({});
  }
});

it("releases empty servers on failed admission and session-prefix cleanup", () => {
  const registry = new McpResourceSubscriptionRegistry();
  expect(registry.begin("failed", "test://resource", "session|failed").release()).toBe(true);
  registry.begin("released", "test://resource", "session|active").commit();
  registry.begin("kept", "test://resource", "other|active").commit();
  expect(registry.removeByPrefix("session|")).toEqual([
    { serverName: "released", uri: "test://resource" },
  ]);
  expect(registry.counts()).toEqual({ kept: { "test://resource": 1 } });
});

it("late settlement cannot resurrect or delete a replacement subscription", () => {
  const registry = new McpResourceSubscriptionRegistry();
  const previous = registry.begin("server", "test://resource", "same");
  registry.remove("server", "test://resource", "same");
  const replacement = registry.begin("server", "test://resource", "same");
  replacement.commit();
  previous.commit();
  expect(previous.release()).toBe(false);
  expect(registry.counts()).toEqual({ server: { "test://resource": 1 } });
  registry.removeByPrefix("same");
  expect(registry.counts()).toEqual({});
});
