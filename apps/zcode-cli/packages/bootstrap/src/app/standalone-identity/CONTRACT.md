# fork-official-identity

Official identity is resolved by the standalone host adapter. Credential snapshots stay owned by the shared credential store; GUI callers retain their injected host.

The existing source file remains a public entrypoint for callers and regression tests.
This module registers the fork boundary without changing runtime behavior.
