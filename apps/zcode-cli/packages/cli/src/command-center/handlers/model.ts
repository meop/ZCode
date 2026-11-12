import type { TuiSubmitPromptResult } from "@zcode/tui";
import { parseModelPickerValue, type ModelSelection } from "@zcode/shared/model-selection";
import { listAppEffortOptions } from "../effort-options.js";
import { rememberCurrentModelSelection } from "../model-selection.js";
import type { GlobalOptions } from "@zcode/shared-types";
import type { CommandCenterApp, CommandCenterDeps, CommandCenterModelOption } from "../types.js";

export async function handleModelCommand(
  args: string,
  deps: CommandCenterDeps,
  selectedRef?: ModelSelection,
): Promise<TuiSubmitPromptResult> {
  const app = await deps.getApp();
  const current = app.getModel?.();
  const options = app.listModels ? await app.listModels() : undefined;

  if (!app.getModel || !app.listModels || !app.setModel || !options) {
    return {
      mode: deps.getMode?.(),
      response: "Model selection is not available in this client.",
    };
  }

  if (!selectedRef && (args.length === 0 || args === "list")) {
    const effortOptions = await listAppEffortOptions(app);
    return {
      ...(effortOptions ? { effortOptions } : {}),
      mode: deps.getMode?.(),
      model: current,
      modelOptions: options,
      response: formatModelList(current, options),
      thoughtLevel: app.getThoughtLevel?.(),
    };
  }

  try {
    const selection = resolveTuiModelSelection(args, options, selectedRef);
    const result = await app.setModel(selection);
    const persistenceWarning = await rememberCurrentModelSelection(app, deps);
    const effortOptions = await listAppEffortOptions(app);
    return {
      ...(effortOptions ? { effortOptions } : {}),
      mode: deps.getMode?.(),
      model: result.model,
      modelOptions: options,
      loginRequired: false,
      response: `Model switched to ${result.model} (${selection.options!.reasoningLevel}).${persistenceWarning}`,
      thoughtLevel: result.thoughtLevel ?? app.getThoughtLevel?.(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      mode: deps.getMode?.(),
      response: `Unable to switch model: ${message}`,
      model: current,
      modelOptions: options,
      thoughtLevel: app.getThoughtLevel?.(),
    };
  }
}

/** A deliberate new selection uses the catalog default; restored selections never pass here. */
export function resolveTuiModelSelection(
  args: string,
  options: readonly CommandCenterModelOption[],
  selectedRef?: ModelSelection,
  effortOverride?: string,
): ModelSelection {
  // Exact catalog matching preserves literal slashes and dollar signs in model IDs.
  const requested =
    selectedRef ??
    options.find((option) => `${option.ref.providerId}/${option.ref.modelId}` === args)?.ref ??
    parseModelPickerValue(args);
  const option = options.find(
    ({ ref }) => ref.providerId === requested.providerId && ref.modelId === requested.modelId,
  );
  if (!option) throw new Error(`Model is not available: ${args}`);
  if (option.disabledReason) throw new Error(option.disabledReason);
  const reasoningLevel =
    effortOverride === undefined
      ? (requested.options?.reasoningLevel ?? option.reasoning?.defaultLevel)
      : requireLaunchEffort(
          effortOverride,
          option.reasoning?.levels.map(({ value }) => value) ?? [],
        );
  if (
    !reasoningLevel ||
    !option.reasoning?.levels.some((level) => level.value === reasoningLevel)
  ) {
    throw new Error(
      `Select a supported reasoning effort: ${option.reasoning?.levels.map((level) => level.value).join(", ") || "none available"}`,
    );
  }
  return {
    providerId: requested.providerId,
    modelId: requested.modelId,
    options: { reasoningLevel },
  };
}

function formatModelList(current: string | undefined, options: CommandCenterModelOption[]): string {
  const currentLine = `Current model: ${current || "not selected"}.`;
  if (options.length === 0) {
    return `${currentLine}\nNo selectable models are configured.`;
  }

  const lines = options.map((option) => {
    const id = `${option.ref.providerId}/${option.ref.modelId}`;
    const provider = option.providerLabel ?? option.ref.providerId;
    const disabled = option.disabledReason ? ` — ${option.disabledReason}` : "";
    return `- ${id} (${option.label}; ${provider})${disabled}`;
  });

  return [
    currentLine,
    "Available models:",
    ...lines,
    "Use /model <provider/model> to select a model, then /effort <level> to change reasoning effort.",
  ].join("\n");
}

/** 启动覆盖只改当前会话；不要走 rememberCurrentModelSelection 写入个人默认值。 */
export async function applyLaunchModelOverrides(
  app: Pick<CommandCenterApp, "listModels" | "setModel" | "listThoughtLevels" | "setThoughtLevel">,
  overrides: Pick<GlobalOptions, "model" | "effort">,
): Promise<void> {
  if (overrides.model !== undefined) {
    if (!app.listModels || !app.setModel)
      throw new Error("Model selection is not available in this client.");
    const models = await app.listModels();
    const selection = resolveTuiModelSelection(
      overrides.model,
      models,
      undefined,
      overrides.effort,
    );
    await app.setModel(selection);
  } else if (overrides.effort !== undefined) {
    if (!app.listThoughtLevels || !app.setThoughtLevel)
      throw new Error("Reasoning effort selection is not available in this client.");
    const effort = requireLaunchEffort(overrides.effort, await app.listThoughtLevels());
    await app.setThoughtLevel(effort);
  }
}

function requireLaunchEffort(requested: string, levels: readonly string[]): string {
  const effort = levels.find((level) => level.toLowerCase() === requested.toLowerCase());
  if (!effort)
    throw new Error(
      `Select a supported reasoning effort: ${levels.join(", ") || "none available"} (received: ${requested}).`,
    );
  return effort;
}
