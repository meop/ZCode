import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSharedZCodeCredentialStore } from "@zcode/adapters/auth";
import { createStandaloneOfficialAuth } from "../src/app/standalone-official-auth.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const jwt = (claims: object) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const platform = jwt({ user_id: "user-1" });
const oauth = jwt({ client_id: "zcode", sub: "user-1" });
const signedIn = {
  "oauth:active_provider": "zai",
  zcodejwttoken: "zcode-jwt",
  "oauth:zai:access_token": platform,
  "oauth:zai:user_info": JSON.stringify({ user_id: "user-1" }),
  "account-provider:account:zai-individual-coding-plan:identity": "user-1",
};

async function setup(credentials: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "zcode-standalone-auth-"));
  dirs.push(dir);
  const env = { ZCODE_DATA_BASE_DIR: dir, ZCODE_CREDENTIAL_SECRET: "test-secret" };
  const store = createSharedZCodeCredentialStore({ env });
  for (const [key, value] of Object.entries(credentials)) await store.save(key, value);
  const auth = createStandaloneOfficialAuth({ env });
  return {
    auth,
    headers: (targetOrigin = auth.officialMcpAuth.resolveZCodeApiOrigin()) =>
      auth.officialMcpAuth.authHeadersPort.resolveHeaders({
        pluginId: "zcode-site",
        mcpKey: "sites",
        targetOrigin,
      }),
  };
}

describe("standalone official auth", () => {
  it("sends the desktop host's headers for a personal Z.ai Coding Plan", async () => {
    const { auth, headers } = await setup(signedIn);
    await expect(headers()).resolves.toEqual({
      ok: true,
      headers: {
        Authorization: "Bearer zcode-jwt",
        "X-Bigmodel-Authorization": `Bearer ${platform}`,
        "Bigmodel-Target-Type": "PERSONAL",
      },
    });
    await auth.close();
  });

  it("never sends an OAuth token not yet swapped for the platform JWT", async () => {
    const { auth, headers } = await setup({ ...signedIn, "oauth:zai:access_token": oauth });
    await expect(headers()).resolves.toEqual({ ok: false, reason: "official_auth_plan_required" });
    await auth.close();
  });

  it("ignores a plan marker left by another user", async () => {
    const { auth, headers } = await setup({
      ...signedIn,
      "oauth:zai:user_info": JSON.stringify({ user_id: "user-2" }),
    });
    await expect(headers()).resolves.toEqual({ ok: false, reason: "official_auth_plan_required" });
    await auth.close();
  });

  it("reads the desktop app's profile shape", async () => {
    const { auth, headers } = await setup({
      ...signedIn,
      "oauth:zai:user_info": JSON.stringify({ rawProfile: { user_id: "user-1" } }),
    });
    await expect(headers()).resolves.toMatchObject({ ok: true });
    await auth.close();
  });

  it("gives no identity to an untrusted origin", async () => {
    const { auth, headers } = await setup(signedIn);
    await expect(headers("https://example.com")).resolves.toEqual({
      ok: false,
      reason: "official_mcp_origin_untrusted",
    });
    await auth.close();
  });

  it("is unavailable when nobody is signed in", async () => {
    const { auth, headers } = await setup({});
    await expect(headers()).resolves.toEqual({ ok: false, reason: "official_auth_unavailable" });
    await auth.close();
  });

  it("hands each session the command endpoint and its own token, until closed", async () => {
    const { auth } = await setup({});
    const workspace = { workspacePath: tmpdir() };
    const env = await auth.officialCommandEnv("sess_a", workspace);
    expect(env.ZCODE_OFFICIAL_ENDPOINT).toBeTruthy();
    expect(env.ZCODE_OFFICIAL_ENDPOINT_TOKEN).toBeTruthy();
    expect(await auth.officialCommandEnv("sess_a", workspace)).toEqual(env);
    const other = await auth.officialCommandEnv("sess_b", workspace);
    expect(other.ZCODE_OFFICIAL_ENDPOINT_TOKEN).not.toBe(env.ZCODE_OFFICIAL_ENDPOINT_TOKEN);
    await auth.close();
    expect(await auth.officialCommandEnv("sess_a", workspace)).toEqual({});
  });
});
