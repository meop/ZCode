import { isFileSystemPortError } from "@zcode/contracts";
import type { ToolExecutionContext } from "../types.js";

/**
 * The retained shell cwd can disappear between commands, most often when a git worktree the
 * session `cd`ed into is removed by a merge. Spawning in a missing directory fails before the
 * shell starts and Node reports it as `spawn /bin/zsh ENOENT`, so a `cd` inside the command
 * cannot recover and every later Bash call fails the same way.
 *
 * Before spawning, check the retained cwd through the file system port, which runs where the
 * command runs. When it is gone, reset to the workspace root and say so in stderr. Any other
 * outcome, including no port or an unexpected stat error, leaves the cwd as it was.
 */
export interface BashMissingCwdRecovery {
  workingDirectory: string;
  stderrSuffix: string;
}

export async function recoverMissingBashWorkingDirectory(
  context: ToolExecutionContext,
): Promise<BashMissingCwdRecovery | undefined> {
  const fileSystemPort = context.fileSystemPort;
  const cwd = context.workingDirectory;
  const root = context.workspaceRoot;
  if (!fileSystemPort || !cwd || !root || cwd === root) return undefined;

  try {
    const stat = await fileSystemPort.stat({ path: cwd }, { signal: context.abortSignal });
    if (stat.kind !== "missing") return undefined;
  } catch (error) {
    if (!isFileSystemPortError(error) || error.code !== "not_found") return undefined;
  }

  await context.setWorkingDirectory?.(root);
  return {
    workingDirectory: root,
    stderrSuffix: `Shell cwd ${cwd} no longer exists; reset to ${root}`,
  };
}

export function joinBashStderrSuffixes(...suffixes: Array<string | undefined>): string | undefined {
  const present = suffixes.filter((suffix): suffix is string => Boolean(suffix));
  return present.length > 0 ? present.join("\n") : undefined;
}
