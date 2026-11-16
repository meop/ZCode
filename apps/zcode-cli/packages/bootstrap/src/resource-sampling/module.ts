/**
 * fork-process-sampling 模块清单（architecture-governance managed 模块）。
 * 层：adapters。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const forkProcessSamplingModule = {
  id: "fork-process-sampling",
  requires: ["zcode-cli", "shared"],
  provides: ["fork-process-sampling"],
  publicEntrypoints: ["contract.ts"],
} as const;
