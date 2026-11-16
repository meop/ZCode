# fork-bash-cwd-recovery

Before spawning Bash, inspect the retained cwd through the filesystem port. A missing cwd resets through the existing runtime setter to the workspace root and reports the recovery in stderr. Other filesystem errors preserve the cwd.

The existing source file remains a public entrypoint for callers and regression tests.
This module registers the fork boundary without changing runtime behavior.
