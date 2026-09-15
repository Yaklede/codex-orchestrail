---
name: orchestrail-setup
description: Set up Orchestrail with the user's reasoning preferences, or change its role models and reasoning levels later in the current project. Also diagnose, update, or remove project profiles while preserving user settings.
---

# Set up Orchestrail

Resolve `../../scripts/orchestrail.mjs` relative to this skill directory. Work in the user's intended Git checkout, not the plugin source folder.

Read [settings and request examples](../../references/settings.md). Run `node RUNTIME config --project PROJECT` to inspect current settings and available presets.

## First setup

When the project is not configured, ask the user how to set the four subagent roles' reasoning levels before writing preferences. Show the proposed model/effort table and offer the existing mixed defaults, all-high, or a custom selection (including a single level for all roles). Use the host's question tool when available. An unanswered question is not a choice. Do not silently use high or call a preset the user has not selected.

If the user already specified preferences in this conversation—such as “use the defaults”, “all xhigh”, or “Sol medium, Astra high”—apply those choices without asking again. Unspecified roles retain the displayed defaults. The labels name configuration presets, not benchmark-proven quality/cost tiers.

Call `setup` with the selected preset and/or role model/effort JSON. Calling it without a choice on an unconfigured project returns `needsPreferences: true` and creates no configuration. Then run `doctor` and report the saved model/effort table.

## Later changes

Handle requests such as “Builder는 medium으로”, “Expert는 Astra max로”, “Sol 작업은 전부 xhigh로”, or a request to change a role's model. Read `config`, map only the requested fields to `configure`, and pass its `configHash` as `expectedConfigHash`. Infer roles from clear context; ask one concise question when the requested role, model, or effort is ambiguous. Use the model identifiers and effort levels actually available on the host. A saved string alone is not proof of model access.

`configure` updates the selected project settings and profile fields together. It preserves other role settings, limits, custom instructions and run history. Show what changed and that it applies to new assignments. Reserved/running assignments retain their original settings; do not interrupt them merely to apply a preference change. Spawn a fresh agent when the new assignment's model or effort differs from an older agent. Use explicit returned model/effort; if the host only supports named profiles, reload them in a new Codex task before using changed preferences.

For setup repair/update without a preference-change request, preserve the saved choices and call `setup` without input; do not repeat onboarding or reset to a preset. Existing profile conflicts must be reconciled without overwriting unrelated user settings.

If the host blocks writes to protected `.codex/agents` paths, use its normal path-scoped permission flow for the requested setup/change when available, preserving existing authorization. Do not change sandbox policy or use unrestricted execution to bypass that boundary. If permission is unavailable, report the actual saved settings from `config`/`doctor`; do not claim the requested change was applied.

The scope is this project and the four subagent roles. The main conversation's model/effort remains under Codex's controls; if the user requests a main-model change, distinguish that host setting from these project preferences. Review/trust bundled hooks in Codex (`/hooks` in CLI) when needed. Installation does not grant hook trust. Never bypass it for end users.

For removal, run `node RUNTIME uninstall --project PROJECT`. It removes only unchanged files this installer owns and retains run history/configuration. Remove the plugin through Codex to disable its skills and hooks. If installed through OpenDock, follow the dock's removal guide; do not remove unrelated docks or overwrite shared hooks.

When hooks are unavailable, the workflow can use explicit helper calls and a manual session ID. Describe this limitation clearly: automatic session injection and native tool guardrails are unavailable.
