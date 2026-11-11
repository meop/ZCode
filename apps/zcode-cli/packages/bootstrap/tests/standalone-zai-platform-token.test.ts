import { describe, expect, it, vi } from "vitest";
import {
  createStandaloneProviderRuntimeHeadersPort,
  standaloneAccountAuthSourceCredentialKey,
  standaloneAccountIdentityCredentialKey,
} from "../src/app/standalone-account-provider-runtime.js";

const providerId = "account:zai-individual-coding-plan";
const tokenKey = "oauth:zai:access_token";

function fixture(platform: string | undefined, onSave?: (values: Map<string, string>) => void) {
  const values = new Map([
    [standaloneAccountIdentityCredentialKey(providerId), "user-1"],
    [standaloneAccountAuthSourceCredentialKey(providerId), "oauth"],
    [tokenKey, "oauth-token"],
  ]);
  const store = {
    load: async (key: string) => values.get(key) ?? null,
    loadMany: async (keys: readonly string[]) =>
      Object.fromEntries(keys.map((key) => [key, values.get(key) ?? null])),
    save: async (key: string, value: string) => void values.set(key, value),
    delete: async (key: string) => void values.delete(key),
    saveIfValue: vi.fn(async (key: string, expected: string, value: string) => {
      onSave?.(values);
      if (values.get(key) !== expected) return false;
      values.set(key, value);
      return true;
    }),
  };
  const resolver = {
    resolve: vi.fn(async () => "project-token"),
    resolveMaterial: vi.fn(async () => ({
      token: "project-token",
      apiKeyId: "key-id",
      organizationId: "org",
      projectId: "proj",
      ...(platform ? { zaiBusinessToken: platform } : {}),
    })),
    clear: vi.fn(),
  };
  const port = createStandaloneProviderRuntimeHeadersPort(store, {}, resolver);
  const request = () =>
    port.refreshBeforeModelRequest({
      providerId,
      modelId: "GLM-5.3",
      accountAccess: {
        type: "zhipu-account",
        accountType: "zai",
        entitled: true,
        mode: "individual-coding-plan",
      },
      reason: "model-request",
      sessionId: "session" as never,
      traceContext: { traceId: "trace" } as never,
    });
  return { values, store, resolver, port, request };
}

describe("Standalone Z.ai platform token", () => {
  it("stores the platform JWT over the OAuth token it came from, and keeps serving", async () => {
    const { values, request, resolver, port } = fixture("platform-jwt");
    const first = await request();
    expect(first.requestAuth).toMatchObject({ apiKey: "project-token" });
    expect(values.get(tokenKey)).toBe("platform-jwt");
    // the swap is not a credential change: the next request reuses the resolver as is
    await port.invalidateChangedCredentials();
    expect(resolver.clear).not.toHaveBeenCalled();
    await request();
    expect(resolver.resolveMaterial).toHaveBeenLastCalledWith(
      expect.objectContaining({ accessToken: "platform-jwt" }),
      expect.anything(),
    );
  });

  it("leaves a newer login alone and drops the request", async () => {
    const { values, request, resolver } = fixture("platform-jwt", (current) =>
      current.set(tokenKey, "newer-login"),
    );
    await expect(request()).rejects.toThrow("project_token_scope_invalidated");
    expect(values.get(tokenKey)).toBe("newer-login");
    expect(resolver.clear).toHaveBeenCalled();
  });

  it("writes nothing when the stored token already is the platform JWT", async () => {
    const { values, store, request } = fixture("oauth-token");
    await request();
    expect(store.saveIfValue).not.toHaveBeenCalled();
    expect(values.get(tokenKey)).toBe("oauth-token");
  });
});
