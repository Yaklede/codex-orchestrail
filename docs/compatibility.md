# Compatibility report

Verified locally on **2026-09-15**, macOS, Node **22.14.0**, Codex CLI **0.154.0**, OpenDock **0.2.0**. Results describe these versions and this account; they do not establish model availability for other users.

## Evidence

| Check | Result | Scope |
| --- | --- | --- |
| Native Sol and Astra execution | Passed | Separate fresh-context native subagents, actual model slugs observed in SubagentStart |
| Full harness with real models | Passed | Sol scout → Astra expert → KEEP_PLAN → command verification → completed local run; both observed models matched requests |
| Real host tool shape | Covered | `collaborationspawn_agent`, opaque message, visible task_name, canonical task response and agent_type default |
| Runtime, package and measurement behavior | 53 tests passed | Routing, plans, evidence freshness, failed fixes, limits, interruption, writer ownership, journal recovery, preference onboarding/updates, native adapter, standalone package installation and benchmark accounting |
| Plugin manifest | Passed | Codex plugin-creator validator, repo marketplace and bundled entrypoint validation |
| Local Codex installation | Passed | Repo marketplace registration and plugin add; installed bundle matched the source bundle; all four skills appeared in `codex debug prompt-input` |
| GitHub CI for the initial implementation | Passed | Linux and macOS checks for commit `0b86d8b`; subsequent commits have their own CI results |
| Preference skill in real Codex conversations | Passed | First setup asked before saving; a later natural-language request changed Builder to medium and Expert to Sol/max while preserving Scout/Reviewer |
| OpenDock manifest | Passed | Installed 0.2.0 parser and task-command validation for macOS/Linux |
| OpenDock file lifecycle | Passed | Its installed collector/planner in a disposable Git fixture; setup doctor ready; update ownership validated; uninstall preserved existing AGENTS.md and local state |
| OpenDock registry review/public install | Not performed | Payload prepared only; no authentication or deploy request |
| 0.3 direct-path pilot | Passed, no savings claimed | Same Astra high, fixed 39 tests both pass; 112,032 vs 114,280 tokens; no tracked state or subagent in direct path |
| 0.3 selective-delegation pilot | Interrupted at budget threshold | Queue source passed 61 tests; Builder completed; parent final verification/complete not finished. Partial usage already exceeds Astra baseline. [Details](benchmark-results-2026-09-15-v03.md). |
| Token-efficiency pilot | Measured, no savings demonstrated | One routine task, three workflows; explicitly delegated harness path used more tokens and missed a reviewed edge case. See [results](benchmark-results-2026-09-15.md). |

The original compatibility smoke tests used **low effort** to keep the compatibility fixture bounded. Production defaults of medium/high are configuration values, not separately benchmarked settings. No real deployment, migration, or production health check was executed.

## Host integration boundaries

The native model/event tests explicitly enabled hooks and supplied the fixture's hook definitions via CLI configuration overrides. They trusted only the test's reviewed recorder and bundled hook in an isolated invocation. End-user instructions never bypass hook trust.

Project `.codex/hooks.json` discovery did not produce events in initial `--ignore-user-config` probes, so merely placing that file is not treated as evidence of active hooks. Use the native plugin installation path and review hooks through Codex. The doctor checks files/configuration and reports the trust step; it cannot certify that the app has approved a hook.

The tested host exposed explicit model and effort parameters on native delegation. Model-bound custom profile discovery in the desktop UI has not been established by this fixture. The workflow uses the exact returned model/effort and a fresh context when the native host does not expose named profiles. It does not silently inherit another model.

Desktop skill picker behavior and a complete production onboarding flow require a fresh task after installation. No cost-saving percentage, hard spending cap, transcript compatibility, unattended scheduling, Windows support, or full tool interception is claimed.

The initial preference-skill smoke correctly asked for a choice before creating configuration. Its first update attempt under the default workspace sandbox was blocked with `EPERM` for `.codex/agents`, and rollback retained the prior settings. Those directories are protected in the [default writable-root policy](https://learn.chatgpt.com/docs/agent-approvals-security#protected-paths-in-writable-roots). With explicit `--add-dir` access to only the disposable fixture's `.codex` directory, both preference scenarios passed. User-facing setup uses the host's normal permission flow if required; it does not bypass the sandbox or report a blocked update as applied. This smoke verifies the saved configuration and profiles, not execution of every supported effort level.

## Reproduce

```bash
pnpm check
pnpm package
pnpm smoke:native
pnpm smoke:harness
pnpm smoke:settings
```

The smoke commands are optional, make real model calls and consume Codex usage. Each prints the temporary fixture location and saves its output locally. Native-agent tests archive their test task; the preference-skill check uses ephemeral tasks. They are excluded from CI.

OpenDock's local validation used a temporary copy of the installed JavaScript CLI bundle to call its manifest parser and file collector/planner without invoking a registry command. This exercises local installation semantics; it is not a public `opendock validate` command or registry acceptance guarantee. The regular package tests validate the generated payload and exercise the standalone helper without depending on OpenDock being installed.

Primary references: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenDock documentation](https://opendock.app/docs/?lang=ko&theme=dark).
