# Standalone CLI help coverage

`zcode --help` / `zcode help` is an offline inventory: it must not create an app,
read credentials, initialize providers or contact a service. It documents public CLI
commands, aliases, arguments, every accepted global flag and its short alias, plugin
options, and hook-trust arguments. Protocol/storage compatibility options are labeled
separately. Private self-reexec entrypoints are not public commands.

The TUI slash section is rendered from the shared built-in slash-command registry,
including usage forms and aliases. Do not keep another slash-command list in the
locale help strings. Include commands gated by launch options, identifying `/workflow`
as requiring workflows enabled. Installed plugin and workspace custom commands are
contextual and are discovered with `/help` inside the TUI, not during `--help` startup.

CLI argument definitions remain owned by the existing strict argument parser. Export
its read-only definitions for regression checks, not a second parser or state owner.
Tests compare both English and Chinese CLI help against all parser long/short flags
and the shared TUI command registry; hook/plugin usage remains owned by its handler
and is reused by root help. Command and argument formatting must describe actual
behavior, including hooks trust, inspect operations, output formats and aliases.
