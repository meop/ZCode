import { AsyncLocalStorage } from "node:async_hooks";
import {
  isHttpClientPortError,
  type HttpClientPort,
  type HttpClientRunOptions,
  type TraceContext,
} from "@zcode/contracts";
import {
  ProjectAccessTokenClient,
  ProjectAccessTokenError,
  ProjectAccessTokenHttpStatusError,
  ProjectAccessTokenTransientError,
  projectAccessTokenRetryAfterMs,
  resolveBigModelApiOrigin,
  type ProjectAccessTokenMaterial,
} from "@zcode/shared";
import { ZaiBusinessTokenCache, type ZaiBusinessToken } from "./zai-business-token-cache.js";

const BUSINESS_AUTH_MAX_ATTEMPTS = 2;
const SINGLE_ATTEMPT = 1;
const PROJECT_TOKEN_REQUEST_TIMEOUT_MS = 15_000;
const ZAI_API_HOST = "https://api.z.ai";
export type CodingPlanFamily = "bigmodel" | "zai";
export interface CodingPlanApiKeyResolverOptions {
  httpClient: HttpClientPort;
  trace?: TraceContext;
  locationStore?: {
    load(key: string): Promise<string | null>;
    save(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  observe?(event: { family: string; stage: "resolve"; code: string }): void;
}
/**
 * The project token, and for Z.ai the platform JWT it was issued with. The caller stores that
 * JWT as the access token in place of the OAuth token it came from, as the desktop app does.
 */
export type CodingPlanMaterial = ProjectAccessTokenMaterial & {
  readonly zaiBusinessToken?: string;
};
export interface ResolveCodingPlanApiKeyInput {
  accessToken: string;
  family: CodingPlanFamily;
  accountIdentity?: string;
  rejectedProjectTokenFingerprint?: string;
  trace?: TraceContext;
}
export interface CodingPlanApiKeyResolver {
  resolve(input: ResolveCodingPlanApiKeyInput, options?: HttpClientRunOptions): Promise<string>;
  resolveMaterial(
    input: ResolveCodingPlanApiKeyInput,
    options?: HttpClientRunOptions,
  ): Promise<CodingPlanMaterial>;
  clear(): void;
}
export class CodingPlanApiKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodingPlanApiKeyError";
  }
}

/** CLI 进程内唯一换证入口；保留旧导出名兼容调用方，返回值已是短期 Token。 */
export function createCodingPlanApiKeyResolver(
  options: CodingPlanApiKeyResolverOptions,
): CodingPlanApiKeyResolver {
  const execution = new AsyncLocalStorage<{
    context?: HttpClientRunOptions["context"];
    trace?: TraceContext;
    business?: ZaiBusinessToken;
  }>();
  const businessTokens = new ZaiBusinessTokenCache(() =>
    options.observe?.({
      family: "zai",
      stage: "resolve",
      code: "project_token_business_login_refresh_deferred",
    }),
  );
  const request = async (url: string, init: RequestInit) => {
    const response = await options.httpClient
      .request(
        {
          url,
          method: init.method === "POST" ? "POST" : "GET",
          headers: Object.fromEntries(new Headers(init.headers)),
          ...(typeof init.body === "string" ? { body: new TextEncoder().encode(init.body) } : {}),
          maxResponseBytes: 64 * 1024,
          timeoutMs: PROJECT_TOKEN_REQUEST_TIMEOUT_MS,
          trace: execution.getStore()?.trace ?? options.trace,
        },
        { context: execution.getStore()?.context },
      )
      .catch((error: unknown) => {
        if (isHttpClientPortError(error) && error.code === "network_error")
          throw new ProjectAccessTokenTransientError({ kind: "network" });
        if (isHttpClientPortError(error) && error.code === "timeout")
          throw new ProjectAccessTokenTransientError({ kind: "timeout" });
        throw error;
      });
    if (response.status === 401 && new URL(url).pathname.startsWith("/api/biz/")) {
      const run = execution.getStore();
      // customer info takes the bare token, the key endpoints Bearer: a 401 on either rejects it
      const authorization = new Headers(init.headers).get("Authorization");
      if (
        run?.business &&
        (authorization === run.business.token || authorization === `Bearer ${run.business.token}`)
      )
        businessTokens.invalidate(run.business);
    }
    if (response.status === 404) return { code: 404 };
    if (response.status === 429 || (response.status >= 500 && response.status < 600))
      throw new ProjectAccessTokenTransientError({
        kind: "http",
        status: response.status,
        ...(response.status === 429
          ? {
              retryAfterMs: projectAccessTokenRetryAfterMs(
                new Headers(response.headers).get("retry-after"),
              ),
            }
          : {}),
      });
    // Bug 原因（ZCT-2111046389485834240）：非临时状态与 2xx 非 JSON 过去都落成
    // project_token_request_failed，无法区分鉴权拒绝与响应损坏。只保留状态码/固定码，不带响应体。
    if (response.status < 200 || response.status >= 300)
      throw new ProjectAccessTokenHttpStatusError(response.status);
    try {
      return JSON.parse(new TextDecoder().decode(response.body)) as unknown;
    } catch {
      throw new ProjectAccessTokenError("project_token_invalid_response");
    }
  };
  // Z.ai's OAuth token lasts an hour, has no refresh, and its exchange is rate limited; the
  // platform JWT the exchange returns lasts months. The desktop app exchanges once at sign-in and
  // stores the platform JWT as the access token (services zaiProviderAdapter); upstream's CLI
  // stored the OAuth token and exchanged it in every process. A stored platform JWT, from either
  // app, is used as is. If the business API rejects it, the bounded retry exchanges it after all,
  // in case it was an OAuth token the check didn't recognise. Storing the JWT is the caller's,
  // from the material's zaiBusinessToken, so it is written under the caller's own scope checks.
  const exchangeBusiness = (stored: string, attempt: number): Promise<unknown> =>
    attempt === 0 && isZaiPlatformToken(stored)
      ? Promise.resolve({ code: 200, data: { access_token: stored } })
      : request(`${ZAI_API_HOST}/api/auth/z/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: stored }),
        });
  const client = new ProjectAccessTokenClient({
    request,
    observe: options.observe,
    locationStore: options.locationStore,
  });
  let generation = 0;
  const resolveMaterial = async (
    input: ResolveCodingPlanApiKeyInput,
  ): Promise<CodingPlanMaterial> => {
    const oauth = input.accessToken.trim();
    if (!oauth) throw new CodingPlanApiKeyError("project_token_login_required");
    const capturedGeneration = generation;
    const maxAttempts = input.family === "zai" ? BUSINESS_AUTH_MAX_ATTEMPTS : SINGLE_ATTEMPT;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (generation !== capturedGeneration)
        throw new CodingPlanApiKeyError("project_token_scope_invalidated");
      const business =
        input.family === "zai"
          ? await businessTokens
              .resolve(oauth, () => exchangeBusiness(oauth, attempt))
              .catch(() => {
                options.observe?.({
                  family: input.family,
                  stage: "resolve",
                  code: "project_token_login_failed",
                });
                throw new CodingPlanApiKeyError("project_token_login_failed");
              })
          : undefined;
      if (generation !== capturedGeneration)
        throw new CodingPlanApiKeyError("project_token_scope_invalidated");
      const loginToken = business?.token ?? oauth;
      const run = execution.getStore();
      if (run) run.business = business;
      try {
        const result = await client.resolve({
          origin: input.family === "zai" ? ZAI_API_HOST : resolveBigModelApiOrigin(process.env),
          family: input.family,
          loginToken,
          accountId: input.accountIdentity ?? input.family,
          personalProjectSelection: "default",
          rejectedProjectTokenFingerprint: input.rejectedProjectTokenFingerprint,
        });
        if (generation !== capturedGeneration)
          throw new CodingPlanApiKeyError("project_token_scope_invalidated");
        return business ? { ...result, zaiBusinessToken: business.token } : result;
      } catch (error) {
        // 只恢复业务 JWT 的明确 HTTP 401；不把模型 401、403 或网络故障猜成过期。
        if (!business || !businessTokens.wasRejected(business)) throw error;
        businessTokens.invalidate(business);
        if (attempt + 1 === maxAttempts) throw error;
        options.observe?.({
          family: input.family,
          stage: "resolve",
          code: "project_token_business_login_refresh",
        });
      }
    }
    throw new CodingPlanApiKeyError("project_token_request_failed");
  };
  const resolveForCaller = (
    input: ResolveCodingPlanApiKeyInput,
    runOptions?: HttpClientRunOptions,
  ) =>
    waitForProjectToken(
      () =>
        execution.run(
          {
            // 单飞属于鉴权 owner，不继承会话 signal 或 context.abortSignal；只保留观测上下文。
            context: runOptions?.context
              ? { trace: runOptions.context.trace, logger: runOptions.context.logger }
              : undefined,
            trace: input.trace ?? runOptions?.context?.trace,
          },
          () => resolveMaterial(input),
        ),
      runOptions?.signal,
    );
  return {
    resolveMaterial: resolveForCaller,
    async resolve(input, runOptions) {
      const value = await resolveForCaller(input, runOptions);
      return value.token;
    },
    clear() {
      generation++;
      businessTokens.clear();
      client.clear();
    },
  };
}

/** 仅取消当前调用方的等待；底层 Promise 始终有拒绝处理器，不误伤共享换证。 */
async function waitForProjectToken<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return run();
  signal.throwIfAborted();
  const value = await new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return run();
      })
      .then(
        (result) => {
          cleanup();
          resolve(result);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
  });
  signal.throwIfAborted();
  return value;
}

/** The platform JWT is a JWT without the client_id claim Z.ai's OAuth access token carries. */
export function isZaiPlatformToken(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as unknown;
    return (
      typeof claims === "object" &&
      claims !== null &&
      !Array.isArray(claims) &&
      !("client_id" in claims)
    );
  } catch {
    return false;
  }
}
