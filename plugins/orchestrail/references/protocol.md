# Runtime protocol

Use Node 22+ and the bundled `scripts/orchestrail.mjs`. Resolve its absolute path from the invoking skill. The helper operates on an existing Git checkout, including an unborn repository.

```bash
node /resolved/plugin/scripts/orchestrail.mjs ACTION --project /project --session SESSION --input /project/.orchestrail/request.json
```

Write the JSON request with a file tool. Avoid embedding user text in shell commands. All operations emit JSON; failures use stderr and exit 1. Hooks use the host's JSON output schema. `setup`, `doctor`, `status`, and `fingerprint` need no request. `status` without a session lists runs; never assume the first run is the active one.

Most requests may include `runId` and `expectedRevision`. The latter rejects stale updates. Native IDs come from hooks or actual tool results, not invented identifiers. A manual session is supported when hooks are unavailable.

## Start and plan

`start`:

```json
{"goal":"Add cancellation retries","constraints":["Keep the existing API"],"criteria":[{"id":"AC-1","description":"Retry behavior passes the focused tests"}]}
```

`route`:

```json
{"kind":"feature","reason":"The repository already has the required retry pattern","unresolvedDecisions":[]}
```

Kinds: routine, feature, greenfield, architecture, incident, deployment. Include `environmentBlocker` when something external prevents progress. For deployment provide the verified `runbook` and list unresolved compatibility/sequence/recovery decisions. Routing does not grant execution permission.

`plan`:

```json
{"summary":"Extend the existing retry policy","invariants":["No duplicate cancellation"],"steps":[{"id":"step-1","objective":"Implement retries and tests","role":"builder","dependsOn":[],"files":["src/retry.ts"],"criteria":["AC-1"]}]}
```

Replace example paths with observed paths. All criteria must be covered. Step IDs must be unique and dependencies acyclic. The runtime assigns increasing plan versions. `revise` accepts the same shape as `start`, increments the task revision, and requires a fresh plan; it preserves history.

## Assign, bind and finish

`assign`:

```json
{"role":"builder","objective":"Implement step-1","stepId":"step-1"}
```

The return value supplies `id`, `taskName`, `model`, `effort`, `planVersion`. Use exactly those settings, pass `taskName` as the native tool's `task_name` when supported, and add `[orchestrail:ASSIGNMENT_ID]` to the delegated message. The task name remains visible to hooks on hosts with opaque message payloads. The supplied task must include goal, relevant plan, constraints and a required Result or Decision contract. Only builders require stepId. One assignment per run and one writer per checkout are supported.

`bind` (only when hooks did not capture it):

```json
{"assignmentId":"assignment-...","nativeAgentId":"actual-id-from-native-tool"}
```

Only include `actualModel` if a host event or tool result explicitly reported it. A requested model is not an observed model.

If the native tool returns `task_name` instead of an ID, use `{"assignmentId":"assignment-…","nativeTaskName":"/root/actual-task-name"}`. Store exactly the returned name and use it for native messages/waits. Hooks can separately record the UUID and observed model from SubagentStart.

`result`:

```json
{"assignmentId":"assignment-...","planVersion":1,"status":"completed","summary":"Implemented retry handling","evidenceIds":[],"blockers":[]}
```

Status: completed, blocked, escalate. A completed assignment does not automatically complete the run. Hook ingestion and identical explicit result submission are idempotent.

## Verification and failed fixes

`verify` executes an argv array directly, without a shell. Use a command already justified by the user's task and project conventions. It inherits the invoking Codex execution context; it does not change permissions.

```json
{"criterionId":"AC-1","argv":["pnpm","test","retry"],"description":"Focused retry tests","timeoutMs":120000}
```

The runtime records output (bounded and redacted), exit code, code hash, task revision and plan version. A command that changes the tracked/unignored code state does not create a passing result; inspect those changes and rerun the appropriate check. Ignored build outputs do not affect the code fingerprint.

Use `fingerprint`, perform the inspection, then `evidence` for qualitative review:

```json
{"criterionId":"AC-1","kind":"inspection","description":"Reviewed the duplicate-cancellation branch","passed":true,"output":"src/retry.ts: observed guard ...","codeHash":"returned-hash","source":"agent"}
```

Never label an agent claim as user or runtime evidence. Successful command evidence requires `verify`.

`attempt` records failed evidence. The initial failure has no fixDescription:

```json
{"criterionId":"AC-1","evidenceId":"evidence-...","cause":"retry exhaustion assertion fails","category":"implementation"}
```

After a real fix changes the code and verification still fails, use a new evidence ID and add `fixDescription`. Two distinct failed fixes trigger expert routing. Repeated output reads, duplicate evidence and unchanged code do not count. Use category `environment` for missing credentials/dependencies or connectivity. Keep cause descriptions stable for the same failure; different causes should not be merged. An expert decision resets the escalation window.

## Expert decisions

Call `packet` for the structured handoff; it preserves goal/criteria/plan and clips long evidence outputs. Include only relevant source excerpts and diffs separately. The packet reports truncation and character counts, not estimated tokens.

`decision`:

```json
{"assignmentId":"assignment-...","outcome":"KEEP_PLAN","summary":"The plan is valid; fix the transaction ordering in step-1"}
```

PATCH_PLAN and REPLAN must include a full `plan` with the same shape as above. KEEP_PLAN and NEEDS_INPUT do not accept plan. A decision completes the expert assignment; do not submit a second Result after it. NEEDS_INPUT pauses work awaiting the missing information. A new follow-up to an expert counts as another assignment even if it reuses a native agent.

## Finish and resume

`complete` accepts no additional fields. It rejects missing/failing/stale criteria and active assignments. `status` exposes missing criteria and assignment/model counts. Token totals and billing are not inferred.

`pause` / `cancel`:

```json
{"reason":"User requested a pause","nativeAgentsStopped":true}
```

First interrupt running agents through native tools and confirm they stopped. An active parent hook does not prove child termination. Then release their recorded assignments. Cancelled runs cannot resume.

`resume` requires `runId`; `--session` may attach the run to a different known native session. Inspect `resumeChanges`, actual commands still running, and external operation status. Never repeat an uncertain deploy operation without checking its outcome. Use `revise` for a new change to a completed run.

## Persistence

Configuration: `.orchestrail/config.json`. The checksum-protected append log is `.orchestrail/events.jsonl`; `.orchestrail/snapshot.json` is its readable projection. Runs contain plans, decisions, evidence and assignments. These local files are Git-ignored by `.orchestrail/.gitignore`.

Updates use a checkout-wide lock and increasing revision. Incomplete final log records are discarded on the next write; corrupt committed records are reported. If a writer crashed, `recover-lock` verifies its PID is gone before removing its lock. Run history is intentionally retained by uninstall.
