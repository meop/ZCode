/**
 * fork-coding-plan-usage 模块清单（architecture-governance managed 模块）。
 * 层：app。修改 requires 时同步更新 architecture-policy.yaml（检查器会校验两者一致）。
 */
export const forkCodingPlanUsageModule = {
  id: "fork-coding-plan-usage",
  requires: ["zcode-cli", "fork-official-identity", "shared"],
  provides: ["fork-coding-plan-usage"],
  publicEntrypoints: ["contract.ts"],
} as const;
