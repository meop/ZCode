/* Official identity headers for the standalone CLI (TUI and --prompt).

   Under the desktop app the agent asks the host for these headers over the protocol
   (interaction/requestOfficialMcpAuthHeaders), and the host builds them from the shared
   credential store (services/official-mcp/officialMcpCredentials.ts). Standalone there is no
   host, so official MCP servers start without identity and the Sites plugin's zcode-site fails
   as UNAUTHENTICATED. This module answers in-process instead, with the host's headers, and serves
   the official command endpoint zcode-site talks to.

   - Every request reads the credentials afresh in one loadMany: a single read of a file written
     by atomic rename under a lock, so one request never mixes two logins. Nothing is cached,
     logged, or put in a child's env; children get only the endpoint's per-session token.
   - Identity goes only to a trusted official origin, checked here for both consumers, on top of
     the MCP adapter's own check and the endpoint's route allowlist.
   - The Coding Plan token is sent only as the platform JWT, as the host does; an OAuth token that
     has not been swapped for it yet is not sent.
   - Standalone supports the personal Coding Plan only, as its request auth does
     (standalone-account-provider-runtime.ts); its marker must belong to the signed-in user. */
import { createMcpTransportFetch } from "@zcode/adapters";
import {
  createSharedZCodeCredentialStore,
  isZaiPlatformToken,
  SHARED_ZCODE_CREDENTIAL_KEYS,
  type SharedZCodeCredentialStore,
} from "@zcode/adapters/auth";
import type {
  Logger,
  OfficialMcpAuthFailureReason,
  OfficialMcpAuthHeadersPort,
  OfficialMcpAuthHeadersResult,
  OfficialMcpTrustedOriginRegistry,
} from "@zcode/contracts";
import {
  createOfficialMcpTrustedOriginRegistry,
  OFFICIAL_MCP_AUTH_HEADER_NAMES,
  OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV,
  resolveRuntimeZCodeEndpointOrigin,
} from "@zcode/shared";
import { createOfficialCommandEndpoint } from "../official-command-endpoint/index.js";
import type { OfficialCommandWorkspace } from "../official-command-endpoint/contract.js";

type Consumer = "mcp-server" | "plugin-command";
type Family = "zai" | "bigmodel";

const individualPlanKey = (family: Family) =>
  `account-provider:account:${family}-individual-coding-plan:identity`;

/** The user id in a stored profile; the CLI and the desktop app write it in different shapes. */
function profileUserId(profile: string | null): string | undefined {
  if (!profile) return undefined;
  try {
    const value = JSON.parse(profile) as {
      user_id?: unknown;
      id?: unknown;
      rawProfile?: { user_id?: unknown };
    };
    const id = value?.user_id ?? value?.id ?? value?.rawProfile?.user_id;
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The headers the desktop host sends, from one consistent read of the credential store. */
export async function resolveStandaloneOfficialHeaders(
  store: Pick<SharedZCodeCredentialStore, "loadMany">,
  consumer: Consumer,
): Promise<OfficialMcpAuthHeadersResult> {
  const fail = (reason: OfficialMcpAuthFailureReason) => ({ ok: false as const, reason });
  const { activeProvider, zcodeJwtToken } = SHARED_ZCODE_CREDENTIAL_KEYS;
  const keys = (family: Family) => ({
    token: `oauth:${family}:access_token`,
    profile: `oauth:${family}:user_info`,
    plan: individualPlanKey(family),
  });
  const all = [
    activeProvider,
    zcodeJwtToken,
    ...Object.values(keys("zai")),
    ...Object.values(keys("bigmodel")),
  ];
  const values = await store.loadMany(all);
  const family = values[activeProvider]?.trim();
  const jwt = values[zcodeJwtToken]?.trim();
  if ((family !== "zai" && family !== "bigmodel") || !jwt) return fail("official_auth_unavailable");
  const k = keys(family);
  const stored = values[k.token]?.trim();
  // BigModel stores its own token as is; Z.ai's must already be the platform JWT
  const planToken =
    stored && (family === "bigmodel" || isZaiPlatformToken(stored)) ? stored : undefined;
  const planIdentity = values[k.plan]?.trim();
  const personal =
    Boolean(planIdentity) &&
    (family === "bigmodel" || planIdentity === profileUserId(values[k.profile] ?? null));
  if (consumer === "mcp-server" && (!planToken || !personal))
    return fail("official_auth_plan_required");
  const headers: Record<string, string> = {
    [OFFICIAL_MCP_AUTH_HEADER_NAMES.authorization]: `Bearer ${jwt}`,
  };
  if (planToken && personal) {
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.codingPlanAuthorization] = `Bearer ${planToken}`;
    headers[OFFICIAL_MCP_AUTH_HEADER_NAMES.targetType] = "PERSONAL";
  }
  return { ok: true, headers };
}

export interface StandaloneOfficialAuth {
  officialMcpAuth: {
    authHeadersPort: OfficialMcpAuthHeadersPort;
    trustedOrigins: OfficialMcpTrustedOriginRegistry;
    resolveZCodeApiOrigin: () => string;
  };
  officialCommandEnv: (
    sessionId: string,
    workspace: OfficialCommandWorkspace,
  ) => Promise<Record<string, string>>;
  close(): Promise<void>;
}

export function createStandaloneOfficialAuth(options: {
  env?: NodeJS.ProcessEnv;
  network?: { httpProxy?: string; noProxy?: string; caCertFile?: string };
  appVersion?: string;
  logger?: Pick<Logger, "debug" | "info" | "warn">;
  store?: Pick<SharedZCodeCredentialStore, "loadMany">;
}): StandaloneOfficialAuth {
  const env = options.env ?? process.env;
  const store = options.store ?? createSharedZCodeCredentialStore({ env });
  // the protocol entrypoint's origin expression, so trust and routing agree
  const resolveZCodeApiOrigin = (): string => resolveRuntimeZCodeEndpointOrigin(env);
  const trustedOrigins = createOfficialMcpTrustedOriginRegistry({
    devTrustedOriginsRaw: env[OFFICIAL_MCP_DEV_TRUSTED_ORIGINS_ENV],
    resolveZCodeApiOrigin,
  });
  const resolve = async (
    consumer: Consumer,
    request: { pluginId: string; mcpKey?: string; targetOrigin: string },
  ): Promise<OfficialMcpAuthHeadersResult> => {
    let result: OfficialMcpAuthHeadersResult;
    try {
      const trust = await trustedOrigins
        .isTrusted({
          origin: request.targetOrigin,
          pluginId: request.pluginId,
          mcpKey: request.mcpKey ?? "",
        })
        .catch(() => ({ trusted: false }));
      result = trust.trusted
        ? await resolveStandaloneOfficialHeaders(store, consumer)
        : { ok: false, reason: "official_mcp_origin_untrusted" };
    } catch {
      result = { ok: false, reason: "official_auth_unavailable" };
    }
    if (!result.ok)
      options.logger?.debug("Standalone official identity unavailable", {
        event: "standalone_official_auth.unavailable",
        consumer,
        pluginId: request.pluginId,
        reason: result.reason,
      });
    return result;
  };
  const endpoint = createOfficialCommandEndpoint({
    resolveHeaders: (request) => resolve("plugin-command", request),
    resolveZCodeApiOrigin,
    appVersion: env.ZCODE_APP_VERSION?.trim() || options.appVersion,
    fetch: createMcpTransportFetch({ env, network: options.network }),
    logger: options.logger,
  });
  return {
    officialMcpAuth: {
      authHeadersPort: { resolveHeaders: (request) => resolve("mcp-server", request) },
      trustedOrigins,
      resolveZCodeApiOrigin,
    },
    officialCommandEnv: (sessionId, workspace) => endpoint.envForSession(sessionId, workspace),
    close: () => endpoint.close(),
  };
}
