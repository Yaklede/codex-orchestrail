---
name: orchestrail-resume
description: Resume a selected interrupted or paused Orchestrail run after checking current code, native agent activity, plan version, and unresolved decisions.
---

# Resume Orchestrail

Resolve `../../scripts/orchestrail.mjs` relative to this skill directory. Read [the protocol](../../references/protocol.md).

Inspect the selected run with `status`, then check whether its native agents/commands still run. Interrupt them only as authorized by the user's resume/cancel request, and verify they stopped before releasing assignments with `pause` and `nativeAgentsStopped: true`. A parent's interruption does not prove child processes stopped.

Call `resume` with `runId` and the current session ID. Inspect reported code changes, plan, evidence, and actual external operation state before continuing. Do not repeat an uncertain deployment command automatically. Old native agent IDs may be unusable; create new bounded assignments from the persisted packet.

For a follow-up change to a completed run use `revise`. A cancelled run requires a new run. For a held file lock, use `recover-lock` only after the recorded owner process has exited; the helper rejects live owners.

Continue with the bundled Orchestrail workflow. Preserve the user's current constraints and authorization. If a model or environment is unavailable, report the concrete blocker rather than silently changing providers or retrying indefinitely.
