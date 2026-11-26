import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import {
  createSystemCredentialCipher,
  enablePrivateFileKeyFallback,
} from "@zcode/shared/credential-security";
import * as resetModule from "../../../../../packages/shared/src/credential-security/boundStoreReset.js";

const dirs: string[] = [];
const reset = vi.spyOn(resetModule, "resetBoundCredentialStore");
beforeAll(() => {
  expect(enablePrivateFileKeyFallback({ resetBoundStore: false })).toBe(true);
});
afterEach(async () => {
  await Promise.all(reset.mock.results.map((result) => result.value));
  reset.mockClear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "zcode-standalone-key-fallback-"));
  dirs.push(dir);
  const filePath = join(dir, "credentials.json");
  const cipher = createSystemCredentialCipher({
    filePath,
    env: {},
    keyStore: {
      get: async () => {
        throw new Error("Secret Service is not available");
      },
      set: async () => {
        throw new Error("Secret Service is not available");
      },
    },
  });
  return { dir, filePath, cipher };
}
it("standalone fallback still initializes fresh stores without a keyring", async () => {
  const { dir, cipher } = await fixture();
  const encrypted = await cipher.encrypt("standalone-login");
  expect(encrypted).toMatch(/^enc:v2:env:/);
  expect(await cipher.decrypt(encrypted)).toBe("standalone-login");
  expect((await readFile(join(dir, "credential-secret"))).length).toBeGreaterThanOrEqual(32);
  expect(reset).not.toHaveBeenCalled();
});
for (const source of ["os", "env"] as const) {
  it(`standalone ${source} key failure preserves the bound store and never schedules a reset`, async () => {
    const { dir, filePath, cipher } = await fixture();
    const credentials = JSON.stringify({ token: `enc:v2:${source}:${"a".repeat(24)}:x.y.z` });
    await writeFile(filePath, credentials);
    const marker = source === "os" ? "credential-source" : "credential-secret";
    const contents = source === "os" ? "os\n" : "invalid-secret";
    await writeFile(join(dir, marker), contents);
    await expect(cipher.initialize()).rejects.toHaveProperty(
      "code",
      "CREDENTIAL_SECURE_STORAGE_UNAVAILABLE",
    );
    // 后台重置在失败的 catch 中排队；如回归触发了它，等待完成再核对磁盘，避免计时猜测。
    await Promise.all(reset.mock.results.map((result) => result.value));
    expect(reset).not.toHaveBeenCalled();
    expect(await readFile(filePath, "utf8")).toBe(credentials);
    expect(await readFile(join(dir, marker), "utf8")).toBe(contents);
    expect((await readdir(dir)).sort()).toEqual([marker, "credentials.json"].sort());
  });
}
