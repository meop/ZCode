# fork-usage-commands

CLI usage commands format bootstrap API results. The command center owns command admission and reset confirmation; the frontend does not persist quota state.

The existing source file remains a public entrypoint for callers and regression tests.
This module registers the fork boundary without changing runtime behavior.
