import { SyntaxStyle, type ThemeTokenStyle } from "@mbears/opentui-core";
import {
  activeTuiTheme,
  getActiveTuiThemeMode,
  type TuiThemeMode,
  type TuiThemeTokens,
} from "./theme/index.js";

// SyntaxStyle 持有需显式销毁的 native 指针，GC 不会释放它。
// 每次 Markdown repaint 都创建会让空闲 MCP 刷新也持续泄漏；TUI 只拥有两种内置主题的样式。
const markdownSyntaxStyles = new Map<TuiThemeMode, SyntaxStyle>();

export function markdownSyntaxRules(theme: TuiThemeTokens): ThemeTokenStyle[] {
  return [
    token(["default"], { foreground: theme.markdownText }),
    token(["markup.heading", "markup.heading.1", "markup.heading.2", "markup.heading.3"], {
      bold: true,
      foreground: theme.markdownHeading,
    }),
    token(["markup.heading.4", "markup.heading.5", "markup.heading.6"], {
      bold: true,
      foreground: theme.markdownHeading,
    }),
    token(["markup.bold", "markup.strong"], {
      bold: true,
      foreground: theme.markdownStrong,
    }),
    token(["markup.italic"], { foreground: theme.markdownEmph, italic: true }),
    token(["markup.list"], { foreground: theme.markdownListItem }),
    token(["markup.quote"], { foreground: theme.markdownBlockQuote, italic: true }),
    token(["markup.raw", "markup.raw.block"], { foreground: theme.markdownCodeBlock }),
    token(["markup.raw.inline"], {
      background: theme.backgroundPanel,
      foreground: theme.markdownCode,
    }),
    token(["markup.link", "markup.link.url"], {
      foreground: theme.markdownLink,
      underline: true,
    }),
    token(["markup.link.label", "label"], {
      foreground: theme.markdownLinkText,
      underline: true,
    }),
    token(["conceal"], { foreground: theme.textMuted }),
    token(["comment"], { foreground: theme.syntaxComment, italic: true }),
    token(["string", "symbol"], { foreground: theme.syntaxString }),
    token(["number", "boolean"], { foreground: theme.syntaxNumber }),
    token(["keyword"], { foreground: theme.syntaxKeyword }),
    token(["function", "function.call", "function.method.call"], {
      foreground: theme.syntaxFunction,
    }),
    token(["type", "type.builtin"], { foreground: theme.syntaxType }),
    token(["operator"], { foreground: theme.syntaxOperator }),
    token(["punctuation", "punctuation.bracket"], { foreground: theme.syntaxPunctuation }),
    token(["diff.plus"], { foreground: theme.diffAdded }),
    token(["diff.minus"], { foreground: theme.diffRemoved }),
    token(["diff.delta"], { foreground: theme.diffHunkHeader }),
    token(["error"], { foreground: theme.error }),
    token(["warning"], { foreground: theme.warning }),
    token(["info"], { foreground: theme.info }),
  ];
}

export function getMarkdownSyntaxStyle(mode = getActiveTuiThemeMode()): SyntaxStyle | undefined {
  const cached = markdownSyntaxStyles.get(mode);
  if (cached) return cached;
  try {
    const style = SyntaxStyle.fromTheme(markdownSyntaxRules(activeTuiTheme(mode)));
    markdownSyntaxStyles.set(mode, style);
    return style;
  } catch {
    return undefined;
  }
}

/** Called by the TUI owner after native renderables have been destroyed. */
export function disposeMarkdownSyntaxStyles(): void {
  for (const style of markdownSyntaxStyles.values()) style.destroy();
  markdownSyntaxStyles.clear();
}

function token(scope: string[], style: ThemeTokenStyle["style"]): ThemeTokenStyle {
  return { scope, style };
}
