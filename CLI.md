# zcode-cli

zcode-cli is ZCode's CLI and TUI, built by [meop/ZCode](https://github.com/meop/ZCode), a fork of
[zai-org/ZCode](https://github.com/zai-org/ZCode), as a single executable: one `zcode` binary with Node and every
runtime asset inside, for every os and arch, released for each upstream ZCode release with a few patches for running
it on its own, without the desktop app.

## Branches and releases

- **`cli/v<upstream>`**: one branch per upstream release (`cli/v3.17.2`), holding this fork's commits on top of that
  release's upstream commit. Branches are kept: an older one serves fixes for its release and records how each patch
  was ported.
- **`VERSION`** is the upstream release the branch is built on (`3.17.2`). A push to a `cli/**` branch whose
  `VERSION` has no release yet builds every target and releases that commit, tagged `zcode-cli-v<VERSION>` and titled
  `v<VERSION>`. The tag carries the project's name because the fork keeps upstream's own `v<semver>` tags. A
  `VERSION` with a pre-release suffix (`3.18.0-rc.1`) is published as a pre-release, which ghpm's latest skips.
- **A new upstream release** (the `upstream` workflow opens an issue for one): make `cli/v<new>` from the new
  upstream commit, and cherry-pick the newest branch's commits onto it one at a time, fixing each up and testing it
  before the next. The older branch is not touched. Release pre-releases (`<new>-rc.1`, `-rc.2`, …) while it
  settles, and `<new>` at the branch's tip once it works.
- The default branch is the newest working `cli/v*`, since GitHub runs the scheduled `upstream` workflow from there.
- ghpm installs the releases as `zcode` (`uri = "github.com/meop/ZCode"`).

## The commits on each branch

1. **build**: `scripts/cli.nu`, the workflows, `VERSION`, this readme, `.npmrc`, and a note at the end of `AGENTS.md`
2. **Z.ai auth**: sign-in keeps the platform JWT, and the build defines the ZCode release
3. **official identity**: official MCP servers and the Sites plugin without the desktop app
4. **TUI commands**: `/exit`, `/usage`, `/reset`, and the app version in `zcode doctor`

## The script

`scripts/cli.nu`, run from anywhere with nu:

| command | does |
| --- | --- |
| `all` | `deps`, `build`, `bin` for this machine, `install` |
| `deps` | `pnpm install --frozen-lockfile`, skipping the desktop app's Electron download |
| `build` | the CLI bundle and every package of its app, and `@zcode/shared`'s dist |
| `bin` | the executable for this machine; `--targets a,b` or `--all` for others |
| `package` | each built target as `dist/release/zcode-cli-<VERSION>-<os>-<arch>.tar.gz` (`.zip` for windows) |
| `install [file]` | a binary to `~/.local/bin/zcode` (`zcode.exe` on windows); this machine's build when no file |

Binaries land in `apps/zcode-cli/packages/cli/dist` as `zcode-<os>-<arch>`, `.exe` on windows, about 220 to 270 MB.

Targets are `darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win-arm64` and `win-x64`, all buildable from
one machine: each target's Node comes from nodejs.org, checked against its SHASUMS256. A macos binary built elsewhere
has a broken signature once the bundle is injected, and arm64 macos won't run it; `install` signs it ad hoc on macos,
and the release workflow builds macos targets on macos, where upstream's build signs them.

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
- **TUI commands**: `/exit` (alias `/quit`) closes the TUI as a confirmed Ctrl-C does. `/usage` (alias `/status`)
  shows the subscription, the 5-hour and weekly token windows, the monthly tool and official MCP calls with their use
  and resets, the window resets granted, and the last 7 days' tokens by model, from the endpoints the desktop app's
  usage panel reads; a part whose endpoint fails is left out. `/reset` lists the window resets granted, after asking
  the server whether a new one is due as the desktop app does; `/reset 5h|week` says what it would spend, and adding
  `now` spends one (`bootstrap/src/app/coding-plan-usage.ts`). `zcode doctor` shows the ZCode release as
  `app version`, under the CLI's `version`.

## What this build leaves out

Release builds read `config/private/build-defaults.json`, which only exists in Z.ai's internal repo. It turns on ARMS
RUM reporting, event reporting and the desktop app's auto-update; without it all three are off. Sign-in, the built-in
providers and the product endpoints are in the source.
