# Orchestrail for OpenDock

Use Sol for implementation and Astra for difficult decisions while staying in one Codex conversation. This dock installs project-local skills, namespaced agent profiles, and the same bundled runtime used by the GitHub Codex plugin.

## Requirements

- An existing Git project and Node 22+. The dock declares their runtime requirements.
- Codex with native subagents and access to the configured Sol/Astra models. Use your own Codex login.
- See the GitHub repository's compatibility report for verified and unverified host behavior.

## Use

After installing the reviewed dock release, open the project in Codex and ask:

> Orchestrail 설정해줘.

Then open a new task, select Sol Medium if desired, and ask:

> Orchestrail로 이 기능 구현하고 테스트해줘.

The setup skill initializes `.orchestrail/`. Continue in the same conversation; plans, decisions, results and verification evidence remain local. Existing model preferences can be changed in `.orchestrail/config.json`, followed by setup.

## Difference from the Codex plugin distribution

OpenDock owns the copied files and the managed AGENTS.md block. The dock does not replace a shared `.codex/hooks.json`, register a global marketplace, change login settings, or install native plugin hooks. It uses explicit helper calls and session IDs for state continuity. Automatic hook injection and native tool interception require the GitHub plugin distribution and trusted, functioning host hooks. Choose one distribution per project to avoid duplicate skill names.

## Update and removal

Use OpenDock update/uninstall for files this dock installed. User-modified files follow OpenDock's ownership checks. Orchestrail run history in `.orchestrail/` is retained. No uninstall step deletes project work or run evidence.

## Publisher notes

Build with `pnpm package:opendock`. The generated `dist/opendock/dock.yml` and payload form the submission root. Sign in to your own OpenDock publisher account and submit using the owner namespace you control, an exact version, and the desired platform. GitHub ownership does not establish an OpenDock publisher namespace. Local packaging never submits a release.

Source: https://github.com/Yaklede/codex-orchestrail
