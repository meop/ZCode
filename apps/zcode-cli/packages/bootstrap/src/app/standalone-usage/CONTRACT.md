# fork-coding-plan-usage

Read subscription, quota and billed history through the business API. Reset mutations occur only on explicit confirmed commands. The API is the source of truth; no independent cache.

The existing source file remains a public entrypoint for callers and regression tests.
This module registers the fork boundary without changing runtime behavior.
