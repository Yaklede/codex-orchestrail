# Tracked work and delegation

Load this only when delegating or continuing a tracked run. For request shapes read [the protocol](protocol.md).

## Route and delegate

The main agent resolves design and compatibility decisions first. A builder route means implementation is ready, not that delegation is mandatory. Use an expert only when the current main agent needs that additional judgment; do not add an Astra child merely because an Astra main agent encounters architecture work. For a remaining unresolved decision, record the expert route with the actual reason. Environment/access problems require their missing input rather than repeated model escalation.

**Explicitly delegate bounded implementation, exploration, review, or decision work to native Codex subagents** when useful independent work is available to the parent. Use `begin` to create the run, route, plan and optional assignment in one transaction. For an existing run, reserve with `assign`, then include `[orchestrail:ASSIGNMENT_ID]`, its objective, current plan version, constraints, and the required result contract in the delegated message. Use the corresponding `orchestrail-scout`, `orchestrail-builder`, `orchestrail-reviewer`, or `orchestrail-expert` profile. When the host exposes model/effort instead of named profiles, pass the exact returned model and effort with a fresh/minimal context. Do not silently inherit a different model.

If the native tool accepts `task_name`, set it to the assignment's returned `taskName`. Some Codex hosts expose opaque message text to hooks; this stable name lets the hook match the reservation. The parent can prepare verification, inspect adjacent constraints, or organize the next decision while the child works. Keep one assignment active at a time in this initial version. Small obvious changes may be handled by the root directly. Never spawn via another runtime, recursively delegate, or use another user's project to create parallel work.

After spawn, record its native ID with `bind` if hooks did not capture it. When the tool returns a canonical task name such as `/root/orchestrail_…`, bind `nativeTaskName` and use that target for native messages/waits. A follow-up to a finished agent is a new assignment: reserve it, include the new marker, and reuse that agent only if its role, model and effort still match. Wait for the required result before advancing dependent work. Fresh contexts are preferred for new expert decisions. After configuration changes, prefer explicit model/effort parameters; named profiles may require a new task to reload.

## Verify and continue

Record each child's Result using `result` if the hook did not ingest it. Expert Decision JSON goes through `decision`; only the root activates a replacement plan. Do not send `result` for an expert after a decision has already completed that assignment.

Run acceptance commands through `verify` with argv (no shell evaluation), a criterion ID, description and timeout. Use `fingerprint` plus `evidence` for reviewed non-command facts. A successful shell command recorded outside `verify` is not sufficient runtime evidence; rerun the focused check through `verify` when appropriate. Never fabricate results, user approvals, or evidence sources.

Record the first failed check using `attempt` without a fix description. Subsequent failed fixes need both a new code state and `fixDescription`. Log polling and rerunning unchanged code are not fixes. For escalation, send `packet` output plus the smallest relevant code/diff; read additional referenced evidence when needed. Do not omit information that could change the decision merely to shrink a packet.

Use `finish` with the remaining acceptance checks, or no checks when current runtime evidence already covers them. It validates and completes in one call. Use the granular `complete` only when all criteria pass on the current code state and assignments have finished. If it rejects completion, address the identified gap or report the blocker. For interruption, cancel/interrupt the native agents first, then record `pause` or `cancel` with `nativeAgentsStopped: true`. Never claim they stopped without checking. Preserve user cancellation and budget pauses.

On ordinary follow-ups, retain decisions and revise the task/criteria when scope changes. If the user asks a status question, answer it without advancing work merely because a hook reports an active run. Report changed behavior, actual verification, unresolved limitations, and requested/observed models succinctly.

For a new project or deployment, read [workflow guidance](workflows.md). Preserve existing authorization; model escalation does not create new permissions. Hook guardrails and assignment limits do not measure all model-internal requests or enforce a hard billing cap.
