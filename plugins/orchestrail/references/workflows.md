# New projects and deployment

## New project

Gather the goal, user flows, constraints and acceptance criteria. Use a bounded Sol scout when independent investigation is useful. Send the unresolved architecture to the expert, including concrete constraints and evidence. Require a versioned plan covering module boundaries, interfaces, invariants, implementation steps and checks. Return to Sol for the first working slice and subsequent steps. Extra requirements that materially change the design create a revised task/plan, not an undocumented implementation detour.

## Deployment

A deployment request should identify the target/environment, code or image revision, established procedure, success checks and failure recovery. Investigate missing information from the repository and existing session before asking the user.

Use Sol for a verified runbook when execution and recovery criteria are clear. Use an expert for unresolved questions such as old/new application compatibility, migration sequencing, backfills, traffic switching and rollback viability. The mere presence of production or multiple tools does not require expert escalation.

Separate the deployment action from its success evidence. Execute only within the user's existing authorization and Codex permissions, then run health/status checks through `verify`. A deploy process returning zero is insufficient when required health checks fail.

Persist identifiers and outcomes needed to distinguish started, completed, failed and unknown external operations. On a resumed run, inspect external state first. Never automatically repeat an uncertain migration, deployment or rollback because a terminal/session ended. A request to change the execution target or destructive scope must be grounded in the user's authorization, not an expert model's recommendation.
