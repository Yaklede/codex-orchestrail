---
name: orchestrail-status
description: Inspect an Orchestrail run's goal, plan, progress, verification evidence, blockers, and model assignments without starting or resuming work.
---

# Orchestrail status

Resolve `../../scripts/orchestrail.mjs` relative to this skill directory. Call `node RUNTIME status --project PROJECT --session SESSION` with the known native or manual session. Use a JSON input containing `runId` for an explicitly selected run. If the session is unknown, `status` without a selector lists available runs; do not guess among multiple active runs.

Summarize the current goal and status, active assignment, missing acceptance criteria, latest decision/blocker, and next useful step. Report requested and observed models separately. Token counts and cost may be unavailable; null does not mean zero. Do not resume or modify the task for a status-only request.

For a model/reasoning settings question, use `config` even when no run exists. Show current project preferences separately from the model/effort captured on existing assignments. A preference change affects new assignments and does not rewrite an agent already running.
