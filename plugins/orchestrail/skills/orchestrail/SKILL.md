---
name: orchestrail
description: "Use Orchestrail in the current Codex conversation: execute directly by default, delegate substantial bounded work when useful, and resume tracked plans and evidence. Applies when the user requests Orchestrail or continues an active Orchestrail run."
---

# Orchestrail

Keep the user in the current conversation. Use the current main model and reasoning level. Astra is the recommended starting baseline for judgment and direct execution, based on the project's pilot; cost savings from delegation remain unproven. Preserve the user's selection. This plugin cannot change the main model or account settings.

## Choose the lightest useful workflow

- **Direct work is the default.** Investigate, edit and verify in the main agent when the work is small, tightly coupled, or still needs substantial judgment. An Orchestrail invocation alone does not require setup, a stored plan, status calls, or a subagent. Do not load the runtime protocol for this path. Native Codex retains the conversation; do not claim a tracked run or measured savings were created.
- **Delegate selectively.** First resolve the important decisions. Delegate a substantial, clearly scoped implementation only when its files, constraints and completion checks are known and useful independent work remains for the parent. The expected saved implementation effort should justify context transfer and review. The configured Builder is normally Sol. Do not force delegation, invent parallel work, or use a fixed token threshold based on one experiment. Continue directly when judgment and implementation must stay together.
- **Continue tracked work.** If the conversation or hook identifies an active/paused run, retain its ownership, constraints and decisions. Read compact `status` once when needed to recover the current state; do not abandon an existing run by switching to an untracked path. Respect user pauses and cancellation. A status question does not authorize continuation.

## When tracking or delegation is needed

Read [tracked work and delegation](../../references/delegation.md) and [the protocol](../../references/protocol.md). Resolve `../../scripts/orchestrail.mjs` from this skill directory to an absolute path. Use the known native session ID or `CODEX_THREAD_ID`; if neither is available, retain the manual session ID returned by `begin` and explain that automatic binding is unavailable. Never adopt another run just because it shares the checkout.

For missing project settings, use [setup](../orchestrail-setup/SKILL.md). An existing user model/effort choice remains valid; ask only for missing preferences. Setup is needed for managed delegation/tracking, not ordinary direct work. Run `doctor` for setup or actual compatibility problems, not at every task start.

Prefer `begin` (start + route + plan + optional reservation) and `finish` (remaining checks + validated completion). Send JSON on stdin with safe quoting or a structured process API; a request file is a fallback, not a mandatory edit per operation. Use compact responses; request full history only to investigate a specific issue. `expectedControlRevision` guards task changes without conflicting with diagnostic hooks. The legacy `expectedRevision` includes every journal event.

Pass the exact reserved model/effort and task name with a fresh, minimal child context. Include the resolved decision, relevant files, constraints and required Result contract. Keep one assignment active, preserve writer ownership, and do not delegate recursively. While the child implements, the parent checks requirements and prepares focused acceptance criteria. Avoid repeating the child's whole investigation or implementation. Count the parent's work, child work and any rework when comparing efficiency.

After the child finishes, reuse valid runtime evidence for unchanged code; run remaining checks once through `finish`. A failed or stale check cannot complete a run. Report the actual outcome and any quality gap without assuming a cheaper model produced equivalent work.

## Preference changes

For later requests to change a role model or reasoning level, follow [setup](../orchestrail-setup/SKILL.md). Preserve unrelated settings and the current task. Existing assignments keep their parameters; a changed model or effort needs a fresh agent. Main-model changes belong to the host's controls.
