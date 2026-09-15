# New projects and deployment

## New project

Gather the goal, user flows, constraints and acceptance criteria. The main agent resolves architecture and implements directly when useful. Delegate a bounded scout or implementation only when the scope is substantial and useful independent work remains. A main Astra agent does not need a second Astra merely to discuss architecture. Use an expert only for a specific additional judgment the main agent needs. For tracked multi-stage work, keep a versioned plan covering module boundaries, interfaces, invariants and checks. Material requirement changes revise the tracked task/plan.

## Deployment

A deployment request should identify the target/environment, code or image revision, established procedure, success checks and failure recovery. Investigate missing information from the repository and existing session before asking the user.

The main agent can execute a verified runbook directly. Consider Sol delegation only when enough bounded work remains to justify the handoff. Resolve old/new application compatibility, migration sequencing, backfills, traffic switching and rollback viability in the main agent; use an expert for a specific unresolved judgment when needed. The mere presence of production or multiple tools does not require delegation.

Separate the deployment action from its success evidence. Execute only within the user's existing authorization and Codex permissions, then run health/status checks through `verify`. A deploy process returning zero is insufficient when required health checks fail.

Persist identifiers and outcomes needed to distinguish started, completed, failed and unknown external operations. On a resumed run, inspect external state first. Never automatically repeat an uncertain migration, deployment or rollback because a terminal/session ended. A request to change the execution target or destructive scope must be grounded in the user's authorization, not an expert model's recommendation.
