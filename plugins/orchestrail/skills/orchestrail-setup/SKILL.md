---
name: orchestrail-setup
description: Set up, diagnose, update, or remove Orchestrail's project-specific Codex agent profiles while preserving existing user configuration.
---

# Set up Orchestrail

Resolve `../../scripts/orchestrail.mjs` relative to this skill directory. Work in the user's intended Git checkout, not the plugin source folder.

1. Run `node RUNTIME doctor --project PROJECT`.
2. For requested setup/update, run `node RUNTIME setup --project PROJECT`. It installs four namespaced agent profiles and initializes local configuration. Existing edits cause a conflict report; inspect and reconcile the exact differences, preserving user choices. Never use force or rewrite unrelated Codex configuration.
3. Run `doctor` again. Read `.orchestrail/config.json` for role-model preferences; change those only when requested, then rerun setup.
4. Explain the remaining host steps: review/trust the bundled hooks in Codex (`/hooks` in CLI), open a new task for agent profile discovery, select Sol Medium as the root if desired, and invoke Orchestrail with the requested goal. Installation does not grant hook trust or guarantee model access. Never bypass hook trust for end users.

For removal, run `node RUNTIME uninstall --project PROJECT`. It removes only unchanged files this installer owns and retains run history/configuration. Remove the plugin through Codex to disable its skills and hooks. If installed through OpenDock, follow the dock's removal guide; do not remove unrelated docks or overwrite shared hooks.

When hooks are unavailable, the workflow can use explicit helper calls and a manual session ID. Describe this limitation clearly: automatic session injection and native tool guardrails are unavailable.
