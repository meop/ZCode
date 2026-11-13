import path from "node:path";
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type BundledTheme,
} from "shiki";
import type { TuiThemeMode } from "./theme/index.js";

const SHIKI_DARK_THEME = "github-dark";
const SHIKI_LIGHT_THEME = "github-light";
const SHIKI_THEMES = [SHIKI_DARK_THEME, SHIKI_LIGHT_THEME] as const;
const HIGHLIGHT_TIMEOUT_MS = 2_500;
const MAX_HIGHLIGHT_ENTRIES = 64;
const MAX_HIGHLIGHT_CHARACTERS = 524_288;
const MAX_HIGHLIGHT_SEGMENTS = 20_000;
const MAX_HIGHLIGHT_SOURCE_CHARACTERS = 65_536;

const LANGUAGE_BY_FILENAME: Record<string, BundledLanguage> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
};

const LANGUAGE_BY_EXTENSION: Record<string, BundledLanguage> = {
  cjs: "javascript",
  cts: "typescript",
  h: "c",
  hpp: "cpp",
  htm: "html",
  mjs: "javascript",
  mts: "typescript",
  psm1: "powershell",
  tsx: "tsx",
  jsx: "jsx",
  swift: "swift",
};

export type ShikiHighlightSegment = {
  color?: string;
  fontStyle?: number;
  text: string;
};

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighterPromise: Promise<ShikiHighlighter> | undefined;
const loadedLanguages = new Set<BundledLanguage>();
const highlightCache = new Map<
  string,
  {
    value: ShikiHighlightSegment[][];
    characters: number;
    segments: number;
  }
>();
let cachedCharacters = 0;
let cachedSegments = 0;

export function inferShikiLanguage(filePath: string | undefined): BundledLanguage | undefined {
  if (!filePath) return undefined;
  const basename = path.basename(filePath).toLowerCase();
  const filenameMatch = LANGUAGE_BY_FILENAME[basename];
  if (filenameMatch) return filenameMatch;

  const extension = path.extname(basename).replace(/^\./u, "");
  if (!extension) return undefined;
  const mapped = LANGUAGE_BY_EXTENSION[extension] ?? extension;
  return isBundledLanguage(mapped) ? mapped : undefined;
}

export async function highlightShikiCodeLines(input: {
  filePath: string | undefined;
  lines: string[];
  mode: TuiThemeMode;
}): Promise<ShikiHighlightSegment[][] | undefined> {
  const language = inferShikiLanguage(input.filePath);
  if (!language) return undefined;
  if (
    input.lines.reduce((size, line) => size + line.length + 1, 0) > MAX_HIGHLIGHT_SOURCE_CHARACTERS
  )
    return undefined;

  const theme = shikiThemeForMode(input.mode);
  const cacheKey = `${theme}\0${language}\0${input.lines.join("\n")}`;
  const cached = highlightCache.get(cacheKey);
  if (cached) {
    highlightCache.delete(cacheKey);
    highlightCache.set(cacheKey, cached);
    return cached.value;
  }

  const highlighted = await withTimeout(
    tokenizeLines({
      language,
      lines: input.lines,
      theme,
    }),
    HIGHLIGHT_TIMEOUT_MS,
  );
  // 源码和 token 数组都曾永久驻留；超时结果也不能缓存为永久的高亮失败。
  if (highlighted) {
    let characters = cacheKey.length;
    let segments = 0;
    for (const line of highlighted) {
      segments += line.length;
      for (const segment of line) characters += segment.text.length;
    }
    if (characters <= MAX_HIGHLIGHT_CHARACTERS && segments <= MAX_HIGHLIGHT_SEGMENTS) {
      const previous = highlightCache.get(cacheKey);
      if (previous) {
        cachedCharacters -= previous.characters;
        cachedSegments -= previous.segments;
        highlightCache.delete(cacheKey);
      }
      highlightCache.set(cacheKey, { value: highlighted, characters, segments });
      cachedCharacters += characters;
      cachedSegments += segments;
      while (
        highlightCache.size > MAX_HIGHLIGHT_ENTRIES ||
        cachedCharacters > MAX_HIGHLIGHT_CHARACTERS ||
        cachedSegments > MAX_HIGHLIGHT_SEGMENTS
      ) {
        const oldest = highlightCache.entries().next().value!;
        highlightCache.delete(oldest[0]);
        cachedCharacters -= oldest[1].characters;
        cachedSegments -= oldest[1].segments;
      }
    }
  }
  return highlighted;
}

export function resetShikiHighlighterForTest(): void {
  highlighterPromise = undefined;
  loadedLanguages.clear();
  highlightCache.clear();
  cachedCharacters = 0;
  cachedSegments = 0;
}

async function tokenizeLines(input: {
  language: BundledLanguage;
  lines: string[];
  theme: BundledTheme;
}): Promise<ShikiHighlightSegment[][] | undefined> {
  try {
    const highlighter = await getHighlighter();
    if (!loadedLanguages.has(input.language)) {
      await highlighter.loadLanguage(input.language);
      loadedLanguages.add(input.language);
    }

    const result = highlighter.codeToTokens(input.lines.join("\n"), {
      lang: input.language,
      theme: input.theme,
    });
    return padTokenLines(
      result.tokens.map((line) =>
        line.map((token) => ({
          color: token.color,
          fontStyle: token.fontStyle,
          text: token.content,
        })),
      ),
      input.lines.length,
    );
  } catch {
    return undefined;
  }
}

function getHighlighter(): Promise<ShikiHighlighter> {
  highlighterPromise ??= createHighlighter({
    langs: [],
    themes: [...SHIKI_THEMES],
  });
  return highlighterPromise;
}

function isBundledLanguage(language: string): language is BundledLanguage {
  return Object.prototype.hasOwnProperty.call(bundledLanguages, language);
}

function shikiThemeForMode(mode: TuiThemeMode): BundledTheme {
  return mode === "light" ? SHIKI_LIGHT_THEME : SHIKI_DARK_THEME;
}

function padTokenLines(
  lines: ShikiHighlightSegment[][],
  expectedLength: number,
): ShikiHighlightSegment[][] {
  if (lines.length >= expectedLength) return lines.slice(0, expectedLength);
  return [...lines, ...Array.from({ length: expectedLength - lines.length }, () => [])];
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
