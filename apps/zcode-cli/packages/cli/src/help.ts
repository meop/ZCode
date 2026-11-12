import { getZCodeCopy, type SupportedLocale, type UiLocale } from "@zcode/i18n";
import { BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES } from "@zcode/shared";
import { PLUGINS_COMMAND_USAGE } from "./plugins-command.js";
import { HOOKS_TRUST_USAGE } from "./hooks-trust-command.js";

// 只翻译摘要；命令集合、参数用法和别名始终来自 TUI 的共享注册表。
const ZH_SLASH_SUMMARIES: Readonly<Record<string, string>> = {
  help: "显示 slash command 帮助。",
  login: "配置 Coding Plan 提供方。",
  logout: "删除共享的 Z.AI 登录凭据。",
  exit: "退出 TUI。",
  usage: "查看 Coding Plan 当前配额。",
  status: "查看 Coding Plan 订阅信息。",
  stats: "查看 Coding Plan 近期统计。",
  reset: "查看或使用 Coding Plan 窗口重置次数。",
  compact: "压缩当前对话，可附带说明。",
  init: "创建或更新工作区 AGENTS.md。",
  expert: "运行或管理 expert workflow。",
  effort: "查看或切换当前会话的推理档位。",
  dwf: "列出、取消或恢复 dynamic workflow run。",
  fork: "从 workspace checkpoint 派生新会话。",
  locale: "查看或切换界面语言。",
  mcp: "查看或管理已配置的 MCP servers。",
  plugins: "打开插件管理器。",
  mode: "查看或切换当前权限模式。",
  model: "查看或切换当前会话的模型。",
  new: "在 TUI 中开始新会话。",
  resume: "恢复已保存的会话。",
  rewind: "查看或恢复 workspace checkpoint。",
  skill: "列出 skills，或强制下一次 prompt 加载指定 skill。",
  goal: "查看或设置当前会话目标。",
  workflow: "设计并启动动态工作流。",
};

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  const copy = getZCodeCopy(locale, detectedLocale);
  const chinese = copy.locale === "zh-CN";
  const commands = BUILTIN_ZCODE_SLASH_COMMAND_HELP_ENTRIES.map((entry) => {
    const summary = chinese ? (ZH_SLASH_SUMMARIES[entry.name] ?? entry.summary) : entry.summary;
    const aliases = entry.aliases?.length
      ? ` (${chinese ? "别名" : "aliases"}: ${entry.aliases.map((alias) => `/${alias}`).join(", ")})`
      : "";
    return `  ${entry.usage}\n    ${summary}${aliases}`;
  });
  return [
    copy.cli.help(version).trimEnd(),
    "",
    PLUGINS_COMMAND_USAGE,
    "",
    HOOKS_TRUST_USAGE.trimEnd(),
    "",
    chinese ? "TUI Slash Commands（内置）:" : "TUI Slash Commands (built-in):",
    ...commands,
    "",
    chinese
      ? "/workflow 需要 --workflow-mode onDemand 或 alwaysOn。"
      : "/workflow requires --workflow-mode onDemand or alwaysOn.",
    chinese
      ? "工作区自定义命令和插件命令因环境而异；在 TUI 中输入 /help 查看当前可用命令。"
      : "Workspace custom and plugin commands vary; use /help inside the TUI for the current workspace.",
    "",
  ].join("\n");
}
