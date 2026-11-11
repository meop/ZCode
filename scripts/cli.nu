# builds zcode-cli, the ZCode CLI as a single executable, packages it, and installs it to ~/.local/bin
#
#   nu scripts/cli.nu all                     # deps, build, bin for this host, install
#   nu scripts/cli.nu bin --targets linux-arm64,win-x64
#   nu scripts/cli.nu package --all           # each built target as a release archive, in dist/release
#   nu scripts/cli.nu install path/to/zcode-darwin-arm64
#
# Node comes from .npmrc (use-node-version), pnpm from package.json (packageManager): both fetched by pnpm for
# this project alone.

const root = path self ..
const cli = path self ../apps/zcode-cli/packages/cli
const all_targets = [darwin-arm64 darwin-x64 linux-arm64 linux-x64 win-arm64 win-x64]

# this machine's target, in upstream's build-sea.mjs names
def host-target []: nothing -> string {
  let os = match $nu.os-info.name {
    windows => 'win'
    macos => 'darwin'
    linux => 'linux'
    $other => { error make {msg: $"no target for os ($other)"} }
  }
  let arch = match $nu.os-info.arch {
    x86_64 => 'x64'
    aarch64 => 'arm64'
    $other => { error make {msg: $"no target for arch ($other)"} }
  }
  $"($os)-($arch)"
}

# the file upstream's build-sea.mjs writes for a target
def binary-name [target: string]: nothing -> string {
  let parts = $target | split row '-'
  if $parts.0 == 'win' { $"zcode-windows-($parts.1).exe" } else { $"zcode-($target)" }
}

def targets-from [targets?: string, all: bool = false]: nothing -> list<string> {
  let want = if $all { $all_targets } else if $targets != null { $targets | split row ',' | str trim } else { [(host-target)] }
  let bad = $want | where $it not-in $all_targets
  if ($bad | is-not-empty) { error make {msg: $"unknown targets: ($bad | str join ', ')"} }
  $want
}

def step [msg: string] { print $"==> ($msg)" }

# the workspace's dependencies, without the desktop app's Electron download
def "main deps" [] {
  step 'pnpm install'
  cd $root
  with-env {ELECTRON_SKIP_BINARY_DOWNLOAD: '1'} { ^pnpm install --frozen-lockfile }
}

# the CLI bundle, and the workspace packages the executable packs beside it
def "main build" [] {
  cd $root
  # every package of the CLI's app, as upstream's build:sea does: the executable packs some the CLI never imports
  # (node-repl-host's MCP runtime), and each one's workspace dependencies come first
  step 'build the CLI app and its workspace packages'
  ^pnpm --filter '{./apps/zcode-cli/packages/*}...' build
  # @zcode/shared has no build script; only tsc -b writes its dist, which the executable step needs
  step 'compile @zcode/shared'
  ^pnpm exec tsc -b packages/shared
}

# the single executable for this host, or for the targets given; each lands in the CLI's dist
def "main bin" [
  --targets: string # comma separated, from: darwin-arm64 darwin-x64 linux-arm64 linux-x64 win-arm64 win-x64
  --all # every target
] {
  let want = targets-from $targets $all
  step $"executable for ($want | str join ', ')"
  cd $cli
  ^pnpm exec node scripts/build-sea.mjs --targets ($want | str join ',')
  $want | each {|t| $cli | path join dist (binary-name $t) } | each {|f| print $"    ($f)" } | ignore
}

# each built target as a release archive in the CLI's dist/release: zcode-cli-<version>-<os>-<arch>.tar.gz holding
# zcode, or .zip holding zcode.exe for windows
def "main package" [
  --targets: string # comma separated; this host's target when neither this nor --all is given
  --all # every target
  --version: string # in the archive names; VERSION's when not given
] {
  let want = targets-from $targets $all
  let ver = if $version != null { $version } else { open --raw ($root | path join VERSION) | str trim }
  let out = $cli | path join dist release
  mkdir $out
  for t in $want {
    let src = $cli | path join dist (binary-name $t)
    if not ($src | path exists) { error make {msg: $"no binary at ($src); run bin first"} }
    let parts = $t | split row '-'
    let os = if $parts.0 == 'win' { 'windows' } else { $parts.0 }
    let name = $"zcode-cli-($ver)-($os)-($parts.1)"
    let stage = $out | path join $name
    rm --recursive --force $stage
    mkdir $stage
    if $os == 'windows' {
      cp $src ($stage | path join zcode.exe)
      let zip = $out | path join $"($name).zip"
      rm --force $zip
      ^zip -q -9 -j $zip ($stage | path join zcode.exe)
      print $"    ($zip)"
    } else {
      cp $src ($stage | path join zcode)
      ^chmod 755 ($stage | path join zcode)
      let tgz = $out | path join $"($name).tar.gz"
      ^tar -czf $tgz -C $stage zcode
      print $"    ($tgz)"
    }
    rm --recursive --force $stage
  }
}

# a built binary to ~/.local/bin/zcode (zcode.exe on windows); this host's build when no file is given
def "main install" [file?: path] {
  let src = if $file != null { $file | path expand } else { $cli | path join dist (binary-name (host-target)) }
  if not ($src | path exists) { error make {msg: $"no binary at ($src); run bin first"} }
  let bin = $nu.home-dir | path join .local bin (if $nu.os-info.name == 'windows' { 'zcode.exe' } else { 'zcode' })
  mkdir ($bin | path dirname)
  # a running binary can't be overwritten on windows, but it can be renamed aside
  let old = $"($bin).old"
  if ($bin | path exists) { mv --force $bin $old }
  cp $src $bin
  try { rm --force $old }
  if $nu.os-info.name != 'windows' { ^chmod 755 $bin }
  # injecting the bundle breaks node's signature, and arm64 macos kills a binary with none
  if $nu.os-info.name == 'macos' { ^codesign --force --sign - $bin }
  step $"installed ($bin)"
  ^$bin version
}

# deps, build, this host's binary, install
def "main all" [] {
  main deps
  main build
  main bin
  main install
}

def main [] {
  print 'usage: nu scripts/cli.nu <deps | build | bin | package | install | all>'
  print '       nu scripts/cli.nu bin --help'
}
