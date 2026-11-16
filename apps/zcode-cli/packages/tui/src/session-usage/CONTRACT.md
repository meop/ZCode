# fork-session-usage

The sidebar projects billed session totals. Mount and idle transitions trigger a read; effect cleanup rejects stale results after session changes. Persistence remains owned by the session store.

The existing source file remains a public entrypoint for callers and regression tests.
This module registers the fork boundary without changing runtime behavior.
