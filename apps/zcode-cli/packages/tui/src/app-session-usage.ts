import { useEffect, useState } from "react";
import type { TuiReadSessionUsage, TuiSessionUsage } from "./types.js";

/**
 * Billed session totals for the sidebar. Reads once on mount and again each time the TUI goes
 * idle, which covers a finished turn, a compaction, and a session switch or resume. No polling:
 * the totals only change when a model request completes.
 */
export function useSessionUsage(
  readSessionUsage: TuiReadSessionUsage | undefined,
  busy: boolean,
  refreshKey: unknown,
): TuiSessionUsage | undefined {
  const [usage, setUsage] = useState<TuiSessionUsage | undefined>();

  useEffect(() => {
    if (!readSessionUsage || busy) return;
    let disposed = false;
    readSessionUsage().then(
      (next) => {
        if (!disposed) setUsage(next);
      },
      () => {
        // Usage is informational; a failed read keeps the last value rather than surfacing an error.
      },
    );
    return () => {
      disposed = true;
    };
  }, [readSessionUsage, busy, refreshKey]);

  return usage;
}
