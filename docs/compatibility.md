# Compatibility report

Verified locally on **2026-09-15**, macOS, Node **22.14.0**, Codex CLI **0.154.0**, OpenDock **0.2.0**. Results describe these versions and this account; they do not establish model availability for other users.

## Evidence

| Check | Result | Scope |
| --- | --- | --- |
| Native Sol and Astra execution | Passed | Separate fresh-context native subagents, actual model slugs observed in SubagentStart |
| Full harness with real models | Passed | Sol scout → Astra expert → KEEP_PLAN → command verification → completed local run; both observed models matched requests |
| Real host tool shape | Covered | `collaborationspawn_agent`, opaque message, visible task_name, canonical task response and agent_type default |
| Runtime and package behavior | 24 tests passed | Routing, plans, evidence freshness, failed fixes, limits, interruption, writer ownership, journal recovery, native adapter and standalone package installation |
| Plugin manifest | Passed | Codex plugin-creator validator, repo marketplace and bundled entrypoint validation |
| Local Codex installation | Passed | Repo marketplace registration and plugin add; installed bundle matched the source bundle; all four skills appeared in `codex debug prompt-input` |
| OpenDock manifest | Passed | Installed 0.2.0 parser and task-command validation for macOS/Linux |
| OpenDock file lifecycle | Passed | Its installed collector/planner in a disposable Git fixture; setup doctor ready; update ownership validated; uninstall preserved existing AGENTS.md and local state |
| OpenDock registry review/public install | Not performed | Payload prepared only; no authentication or deploy request |

Real-model tests used **low effort** to keep the compatibility fixture bounded. Production defaults of medium/high are configuration values, not separately benchmarked settings. No real deployment, migration, or production health check was executed.

## Host integration boundaries

The native model/event tests explicitly enabled hooks and supplied the fixture's hook definitions via CLI configuration overrides. They trusted only the test's reviewed recorder and bundled hook in an isolated invocation. End-user instructions never bypass hook trust.

Project `.codex/hooks.json` discovery did not produce events in initial `--ignore-user-config` probes, so merely placing that file is not treated as evidence of active hooks. Use the native plugin installation path and review hooks through Codex. The doctor checks files/configuration and reports the trust step; it cannot certify that the app has approved a hook.

The tested host exposed explicit model and effort parameters on native delegation. Model-bound custom profile discovery in the desktop UI has not been established by this fixture. The workflow uses the exact returned model/effort and a fresh context when the native host does not expose named profiles. It does not silently inherit another model.

Desktop skill picker behavior and a complete production onboarding flow require a fresh task after installation. No cost-saving percentage, hard spending cap, transcript compatibility, unattended scheduling, Windows support, or full tool interception is claimed.

## Reproduce

```bash
pnpm check
pnpm package
pnpm smoke:native
pnpm smoke:harness
```

The two smoke commands are optional, make real model calls and consume Codex usage. Each prints the temporary fixture location and a JSON result, saves event/output evidence locally, and archives its test task. They are excluded from CI.

OpenDock's local validation used a temporary copy of the installed JavaScript CLI bundle to call its manifest parser and file collector/planner without invoking a registry command. This exercises local installation semantics; it is not a public `opendock validate` command or registry acceptance guarantee. The regular package tests validate the generated payload and exercise the standalone helper without depending on OpenDock being installed.

Primary references: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenDock documentation](https://opendock.app/docs/?lang=ko&theme=dark).
