---
name: orchestrail
description: Use Orchestrail to implement, fix, plan, or deploy a project in the current Codex conversation, routing execution to Sol and unresolved decisions to Astra. Applies when the user requests Orchestrail or continues an active Orchestrail run.
---

# Orchestrail

Keep the user in the current conversation. Codex runs the agents; the bundled helper stores plans, assignments and verification. Read [the protocol](../../references/protocol.md) for JSON requests and examples.

## Start or continue

Resolve `../../scripts/orchestrail.mjs` relative to this skill directory into an absolute path (RUNTIME below). Call `node RUNTIME doctor --project PROJECT`. If setup is missing, read [the setup skill](../orchestrail-setup/SKILL.md) and obtain the user's reasoning preferences before saving configuration; an explicit preference already given in this conversation is sufficient. Do not change the current root model or user login settings. Sol Medium is the recommended root; preserve an explicit user choice.

When the user changes a role's model or reasoning level, follow the setup skill's configuration-change workflow. Apply only the requested settings and retain the current task. Read the model/effort returned by each new assignment instead of reusing an old configuration table. Existing assignments keep their parameters; a different model or effort requires a fresh native agent.

Use the native session ID supplied by the Orchestrail hook, or `CODEX_THREAD_ID` if the host supplies it. Pass `--session ID` on helper calls. If neither exists, `start` creates a manual session; retain its returned ID and explain that automatic session binding is unavailable. Never select another active run merely because it shares a directory.

Inspect `status`. Start a new run with explicit goal, constraints, and acceptance criteria, or `revise` an existing run for a changed request. Save a small plan even for a direct edit. The runtime validates dependencies, criteria, plan versions, writer ownership and completed evidence.

## Route and delegate

Use the runtime `route` operation with evidence about the task. Default to Sol for established patterns, clear fixes, and known deployment procedures. Request Astra for new architecture, unresolved compatibility/invariant decisions, or two distinct failed fixes for the same cause. Environment/access problems require their missing input rather than repeated model escalation.

**Explicitly delegate bounded implementation, exploration, review, or decision work to native Codex subagents** when useful independent work is available to the parent. Reserve one assignment with `assign`, then include `[orchestrail:ASSIGNMENT_ID]`, its objective, current plan version, constraints, and the required result contract in the delegated message. Use the corresponding `orchestrail-scout`, `orchestrail-builder`, `orchestrail-reviewer`, or `orchestrail-expert` profile. When the host exposes model/effort instead of named profiles, pass the exact returned model and effort with a fresh/minimal context. Do not silently inherit a different model.

If the native tool accepts `task_name`, set it to the assignment's returned `taskName`. Some Codex hosts expose opaque message text to hooks; this stable name lets the hook match the reservation. The parent can prepare verification, inspect adjacent constraints, or organize the next decision while the child works. Keep one assignment active at a time in this initial version. Small obvious changes may be handled by the root directly. Never spawn via another runtime, recursively delegate, or use another user's project to create parallel work.

After spawn, record its native ID with `bind` if hooks did not capture it. When the tool returns a canonical task name such as `/root/orchestrail_…`, bind `nativeTaskName` and use that target for native messages/waits. A follow-up to a finished agent is a new assignment: reserve it, include the new marker, and reuse that agent only if its role, model and effort still match. Wait for the required result before advancing dependent work. Fresh contexts are preferred for new expert decisions. After configuration changes, prefer explicit model/effort parameters; named profiles may require a new task to reload.

## Verify and continue

Record each child's Result using `result` if the hook did not ingest it. Expert Decision JSON goes through `decision`; only the root activates a replacement plan. Do not send `result` for an expert after a decision has already completed that assignment.

Run acceptance commands through `verify` with argv (no shell evaluation), a criterion ID, description and timeout. Use `fingerprint` plus `evidence` for reviewed non-command facts. A successful shell command recorded outside `verify` is not sufficient runtime evidence; rerun the focused check through `verify` when appropriate. Never fabricate results, user approvals, or evidence sources.

Record the first failed check using `attempt` without a fix description. Subsequent failed fixes need both a new code state and `fixDescription`. Log polling and rerunning unchanged code are not fixes. For escalation, send `packet` output plus the smallest relevant code/diff; read additional referenced evidence when needed. Do not omit information that could change the decision merely to shrink a packet.

Call `complete` only when all criteria pass on the current code state and assignments have finished. If it rejects completion, address the identified gap or report the blocker. For interruption, cancel/interrupt the native agents first, then record `pause` or `cancel` with `nativeAgentsStopped: true`. Never claim they stopped without checking. Preserve user cancellation and budget pauses.

On ordinary follow-ups, retain decisions and revise the task/criteria when scope changes. If the user asks a status question, answer it without advancing work merely because a hook reports an active run. Report changed behavior, actual verification, unresolved limitations, and requested/observed models succinctly.

For a new project or deployment, read [workflow guidance](../../references/workflows.md). Preserve existing authorization; model escalation does not create new permissions. Hook guardrails and assignment limits do not measure all model-internal requests or enforce a hard billing cap.
