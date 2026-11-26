# zcode-cli

zcode-cli is ZCode's CLI and TUI, built by [meop/ZCode](https://github.com/meop/ZCode), a fork of
[zai-org/ZCode](https://github.com/zai-org/ZCode), as a single executable: one `zcode` binary with Node and every
runtime asset inside, for every os and arch, released for each upstream ZCode release with custom patches for running
it on its own, without the desktop app.

## Status of 4.0.0

Based on upstream tag `v4.0.0` (`a4b44451`), with `VERSION=4.0.0-rc.1` for the initial release candidate.
The working 3.18.2 standalone patch stack is carried forward. Upstream's MCP hot reload and workspace trust,
new browser/runtime flags, ADB shell preparation, proportional compaction output reserve and credential-generation
write guards are preserved. The configurable compaction ceiling caps the new upstream threshold.

The [3.18.2 → 4.0.0 port comparison](docs/cli-ports/4.0.0.md) pins both branches and upstream bases, maps every
carried commit, records adaptations and corrected failures, and gives validation commands, results and remaining limits.
Local validation passed 1,311 selected regressions, typechecks, lint and Linux runtime checks. CI built all six targets
and published [4.0.0-rc.1](https://github.com/meop/ZCode/releases/tag/zcode-cli-v4.0.0-rc.1).
Other-platform runtime checks and a long authenticated memory soak remain untested locally.

## Branches and releases

- **`cli/v<upstream>`**: one branch per upstream release (`cli/v4.0.0`), holding this fork's commits on top of that
  release's tagged upstream commit. Upstream tags are the release signal; untagged source-sync commits do not
  automatically qualify as supported releases. Older working branches can serve maintenance fixes; discard a
  superseded, unfinished port only after its replacement works.
- **`VERSION`** supplies the executable version, including its pre-release suffix. The app version sent to upstream
  services remains the base GUI release from root `package.json`. A push to a `cli/**` branch whose
  `VERSION` has no release yet builds every target and releases that commit, tagged `zcode-cli-v<VERSION>` and titled
  `v<VERSION>`. The tag carries the project's name because the fork keeps upstream's own `v<semver>` tags. A
  `VERSION` with a pre-release suffix (`3.18.0-rc.1`) is published as a pre-release, which ghpm's latest skips.
- **A new upstream release** (the `upstream` workflow opens an issue for one): make `cli/v<new>` from the new
  tagged upstream release commit. Review the latest working stack and any unfinished newer port, then adapt their
  behavior to the new source. Cherry-picking is a starting point, not the acceptance criterion. Preserve working older
  releases. Release pre-releases (`<new>-rc.1`, `-rc.2`, …) while it settles, and `<new>` once it works.
- The default branch is the newest working `cli/v*`, since GitHub runs the scheduled `upstream` workflow from there.
- ghpm installs the releases as `zcode` (`uri = "github.com/meop/ZCode"`).

## Maintenance policy

Every new `cli/v<upstream>` branch must check in `docs/cli-ports/<upstream>.md` and link it from the release status
above. Carry earlier port records forward as history. Keep `CLI.md` as the current operating guide and short status;
the per-release document is the comparison and evidence record. Create it during the port, then update it with actual
validation and publication results. Pin the old/new upstream bases and fork commits; a moving branch name alone is
insufficient. Include the reproducible upstream diff, patch-stack range-diff and fork-to-fork comparison; the disposition
of every carried feature/commit (unchanged, adapted, replaced by upstream, dropped or deferred, with reasons); new
fork work and corrected failures; commands, observed results and durable CI/release links; and remaining untested areas.
Distinguish patch-equivalence, source review, automated tests, manual observations and build-only evidence. Never count
a skipped check as passed or infer behavior preservation from a clean cherry-pick. Documentation-only follow-ups may
follow the pinned executable-source commit; do not move an existing release tag to include them.

The goal is a working independent CLI/TUI, not the smallest possible diff against the GUI app. Keep reviewable commits
by logical feature and fold direct corrections into their feature when practical. Independent follow-up work can have
its own commit; there is no minimum commit count or requirement to keep every future branch at 13 commits.

Use upstream improvements when they preserve our behavior, and drop carried fixes that upstream has made unnecessary.
If upstream moves environment setup, identity, configuration, lifecycle or other previously shared behavior into the GUI
host, provide the required functionality within our standalone CLI/TUI. Maintaining CLI-specific implementations of
previously shared code is acceptable. Preserve host-owned behavior for GUI callers and keep standalone ownership explicit.

Before retiring an unfinished version port, carry forward its useful changes and investigate its recorded failures.
The first 3.18.0 port identified missing standalone model selection, an MCP negotiation rejection during early shutdown,
and a credential-store migration to OS-keyring/headless-secret encryption. Verify these on each new release rather than assuming
clean cherry-picks imply a working app. Credential migration tests must use an isolated HOME and copied data, since
`ZCODE_DATA_BASE_DIR` does not redirect every credential path and 3.17.2 cannot read the newer encrypted values.

When rewriting a published fork branch, keep a local backup, verify its remote tip, push with an exact force-with-lease,
and compare the final source tree. Existing release tags retain their historical source; a new source release needs a
new VERSION. Keep each version branch on its own upstream base.

## Carried behavior from 3.17.2

1. **Build and release**: standalone executables, workflows, VERSION, tooling and maintenance documentation.
2. **Z.ai auth**: retain the platform JWT and define the app release in CLI builds.
3. **Official identity**: official MCP servers and Sites without the desktop host.
4. **TUI commands**: `/exit`, `/usage`, `/status`, `/stats`, `/reset`, and doctor app version.
5. **Launch selection**: `--model` / `-m` and `--effort` without changing saved defaults.
6. **Help**: public CLI forms, flags and built-in slash commands checked against registries.
7. **Session input history**: recall isolated to the active session.
8. **TUI usage**: cumulative turn/cache metrics and billed session totals in the sidebar.
9. **TUI resource bounds**: native style ownership, bounded highlighting and diff rendering.
10. **Standalone housekeeping and diagnostics**: event pruning, correlated memory logs, Linux process-tree observer.
11. **Terminal title**: project and active session.
12. **Compaction**: configurable automatic token ceiling.
13. **Bash cwd recovery**: recover when the retained directory was removed.

The daily upstream watcher checks tags and opens an issue for a missing version branch. It does not automatically
create or port a branch or open a PR.

## Comparison repositories

Use these as implementation references and sources of ideas; check their current code before adopting a design:

- [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code), locally `/vol/code/MoonshotAI/kimi-code`:
  pi-based CLI/TUI; reference for turn destruction and folding older steps.
- [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli), locally `/vol/code/kingsword09/zcode-cli`:
  another pi-based ZCode CLI; reference for bounded blocks/characters and explicit memory benchmarks.
- [anomalyco/opencode](https://github.com/anomalyco/opencode), locally `/vol/code/anomalyco/opencode`:
  independent harness with its own OpenTUI frontend; reference for transcript tail mounting and loading older rows.

The 3.17.2 fixes do not implement transcript paging. Short unauthenticated idle tests do not establish long-session or
connected-plugin stability. Compare process-tree PSS, native allocations and JS heap separately when diagnosing growth.

## The script

`scripts/cli.nu`, run from anywhere with nu:

| command          | does                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `all`            | `deps`, `build`, `bin` for this machine, `install`                                              |
| `deps`           | `pnpm install --frozen-lockfile`, skipping the desktop app's Electron download                  |
| `build`          | the CLI bundle and every package of its app, and `@zcode/shared`'s dist                         |
| `bin`            | the executable for this machine; `--targets a,b` or `--all` for others                          |
| `package`        | each built target as `dist/release/zcode-cli-<VERSION>-<os>-<arch>.tar.gz` (`.zip` for windows) |
| `install [file]` | a binary to `~/.local/bin/zcode` (`zcode.exe` on windows); this machine's build when no file    |

Binaries land in `apps/zcode-cli/packages/cli/dist` as `zcode-<os>-<arch>`, `.exe` on windows, about 220 to 270 MB.

Targets are `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win-arm64` and `win-x64`, all buildable from
one machine: each target's Node comes from nodejs.org, checked against its SHASUMS256. A macos binary built elsewhere
has a broken signature once the bundle is injected, and arm64 macos won't run it; `install` signs it ad hoc on macos,
and the release workflow builds macos targets on macos, where upstream's build signs them.

The macos release job uses GitHub's standard `macos-15-intel` pool and builds both `darwin-arm64`
and `darwin-x64`. Runtime assets are selected for each target architecture, independently of the build host.

Node and pnpm are the project's own: `.npmrc` sets `use-node-version` to the node `mise.toml` pins, which pnpm
fetches into its cache, and `package.json`'s `packageManager` pins pnpm.

Upstream gaps the script covers: `@zcode/shared` has no build script, so its dist comes from `tsc -b`; and upstream's
`build:sea` builds every package of the CLI's app, some of which (node-repl-host's MCP runtime) the CLI never imports.
`deps` runs the repo's `prepare` script, which points this clone's `core.hooksPath` at `.husky/_`, whose pre-push hook
runs upstream's checks.

## The patches

- **Z.ai sign-in** (`adapters/src/auth/coding-plan-api-key.ts`, `bootstrap/src/auth-login.ts`,
  `bootstrap/src/app/standalone-account-provider-runtime.ts`). Z.ai's OAuth token lasts an hour, has no refresh, and
  its exchange for the platform JWT (`api.z.ai/api/auth/z/login`) is rate limited; the platform JWT lasts months. The
  desktop app exchanges once at sign-in and stores the platform JWT as `oauth:zai:access_token`. Upstream's CLI stored
  the OAuth token and exchanged it in every process, so it failed on the limit (`project_token_login_failed`, the
  server saying "Z.ai user information is invalid") and, an hour after login, for good. Here sign-in stores the
  platform JWT; a stored platform JWT, from either app, is used without exchanging, and a 401 from the business API,
  bare or Bearer, exchanges it after all on the retry; a stored OAuth token is swapped for the platform JWT after its
  first exchange, by compare-and-set under the credential file's lock, so a newer login is never overwritten. The two
  apps share `~/.zcode/v2/credentials.json`.
- **The ZCode release** (`cli/scripts/build.mjs`). The desktop build defines `__ZCODE_VERSION__` as its release; the
  CLI build never did, so the CLI told Z.ai's servers `0.0.0-dev`, and Sites refused it as too old (3609). The CLI
  build defines it from the repo's version; `zcode version` still prints the CLI's own.
- **Official identity** (`bootstrap/src/app/standalone-official-auth.ts`, wired in `create-app.ts`). Official MCP
  servers and the Sites plugin's `zcode-site` get the signed-in identity from a host: the agent asks over the protocol,
  and only the desktop app answers. When no host does, the CLI answers in-process with the host's headers and serves
  the command endpoint `zcode-site` talks to. Each request reads one credential snapshot; identity goes only to a
  trusted official origin; the Coding Plan token goes only as the platform JWT, and only for a personal plan of the
  signed-in user.
- **TUI commands**: `/exit` (alias `/quit`) closes the TUI as a confirmed Ctrl-C does. `/usage`
  shows only the current 5-hour and weekly token windows, monthly tool calls and official MCP calls with their use
  and reset times. `/status` shows the subscription, billing cycle and renewal/end date. `/stats [days]` defaults to
  the last 7 days (including today), accepts 1–30, and shows token/call totals and tokens by model.
  These commands start with descriptive titles; statistics omit hourly and empty time rows. Each command fetches
  only its own data. Quota and history failures are shown;
  optional MCP data is left out if unavailable. `/reset` lists the window resets granted, after asking
  the server whether a new one is due as the desktop app does; `/reset 5h|week` says what it would spend, and adding
  `now` spends one (`bootstrap/src/app/coding-plan-usage.ts`). `zcode doctor` shows the ZCode release as
  `app version`, under the CLI's `version`.

## Standalone credential storage

Login still persists the long-lived Z.ai platform JWT and reuses it across launches, deriving short-lived project
keys as needed. The server decides its expiry (often described as about 180 days); the fork does not promise or impose
that duration. A valid cached JWT avoids the one-hour OAuth-token exchange on every launch.

3.18 and later use newer encryption at rest for `~/.zcode/v2/credentials.json`. On Linux, our standalone entrypoint enables a
private `credential-secret` file fallback when a fresh directory has no usable Secret Service/keyring. Later launches
discover that file automatically; no GUI, desktop session, or secret environment variable is required. Keep the secret
with its encrypted credential file. Existing OS-bound stores retain their original key source; never silently switch
or replace their key. macOS/Windows retain native key storage. Desktop/protocol-hosted invocations retain upstream
host ownership. Older 3.17.2 binaries cannot read credentials migrated to the newer encryption format.

The headless regression starts two fresh CLI processes with an isolated HOME and an unavailable D-Bus address,
verifies a 0600 secret and encrypted credential file, then reopens the cached login without a keyring.

For the first push of a new version branch, upstream's engineering hook assumes its internal `origin/staging` exists.
Use the actual tagged base explicitly, for example `ZCODE_AFFECTED_TEST_BASE=v4.0.0 git push -u fork cli/v4.0.0`.
This runs the affected-test gate against our real upstream base.

## Launch model and effort

`zcode --model <provider/model> --effort <level>` (or `-m`) overrides the initial TUI
or `-p` session without changing saved defaults. Either flag works alone; effort is
validated against the selected model. Model-only uses its catalog-default effort.
Overrides also apply after `--resume` / `--continue` restoration. Later TUI switches
keep their existing behavior, including selecting the catalog-default effort.

## Help

`zcode --help` lists CLI commands, positional forms, parsed flags/aliases and their scopes,
plugin and hook-trust command forms, and all built-in TUI slash commands. The slash section
uses the same registry as TUI `/help`; plugin and workspace commands are discovered in the
TUI. Help stays offline and does not start an app or load credentials. Regression checks
compare English and Chinese help with the actual flag definitions and slash registry.

## Session-scoped input history

Input recall is stored per session, so commands entered in one running TUI do not appear in another session's history.

## TUI usage and resource bounds

The TUI reports cumulative turn token usage, cache metrics when available, and billed session totals. Native markdown styles are reused
and released, syntax highlighting retention and rendered diff output are bounded to limit memory growth during long
sessions.

## Standalone event housekeeping

Standalone CLI sessions prune retained events and periodically sample process memory so long-running processes do not
retain unbounded event history silently.

On Linux, collect the main process and its children while using the CLI normally:

```sh
python3 scripts/cli-memory-watch.py --pid <main-cli-pid> --output /persistent/path/zcode-memory.jsonl
```

The observer samples every 60 seconds for 24 hours by default (`--interval` and `--duration` override seconds).
It records process identities, executable paths, PSS, private memory, swap, threads and descriptor counts;
it does not collect command arguments or send signals. Output rotates at 5 MiB with three backups.
Use PSS + SwapPss for physical process-tree footprint; summed RSS double-counts shared executable pages.
Missing smaps permissions are explicit in each sample. The CLI's existing `standalone.process.memory_sample`
log event supplies PID, stable `processInstanceId`, uptime, CPU, main-thread JS heap and event-store counts.
Compare that heap with process RSS/PSS to distinguish JS retention from native/worker growth, and inspect
child samples independently. The collector needs Python 3 and Linux procfs; it is not a cross-platform CLI command.

## Terminal title

Interactive terminals set their title from the project and active session.

## Auto-compaction ceiling

Set `compact.autoTokenLimit` in `~/.zcode/cli/config.json` or `ZCODE_AUTOCOMPACT_TOKEN_LIMIT` to compact earlier.
Unset uses the model-derived threshold. This does not alter provider caching or select a smaller context.

## Bash cwd recovery

If a retained shell directory was deleted, Bash recovers to the workspace directory before executing the next command.

## What this build leaves out

Release builds read `config/private/build-defaults.json`, which only exists in Z.ai's internal repo. It turns on ARMS
RUM reporting, event reporting and the desktop app's auto-update; without it all three are off. Sign-in, the built-in
providers and the product endpoints are in the source.
