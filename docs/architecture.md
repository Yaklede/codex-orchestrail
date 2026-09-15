# Current architecture

Orchestrail 0.1.0 runs inside the user's existing Codex conversation. Native Codex owns model execution and authorization. The bundled Node helper owns local records and validates transitions; it does not call an API, spawn models, or maintain a separate scheduler.

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Workflow | `plugins/orchestrail/skills` | Setup, routing, delegation, verification, status, resume |
| Role profiles | `plugins/orchestrail/templates/agents` | Scout, builder, reviewer, expert model/effort and instructions |
| Contracts | `packages/runtime/src/contracts.ts` | Validated command inputs and configuration |
| Engine | `packages/runtime/src/engine.ts` | Plans, reservations, evidence, decisions and run transitions |
| Store | `packages/runtime/src/store.ts` | Serialized changes, committed journal, snapshot projection |
| Files | `packages/runtime/src/files.ts` | Fingerprints, atomic writes, locks, path ownership checks |
| Host adapter | `packages/runtime/src/hooks.ts` | Session context, native delegation checks and observations |
| Installer | `packages/runtime/src/install.ts` | Project profile setup, conflict detection, doctor and removal |

## State and invariants

Each checkout has one `.orchestrail/events.jsonl`. Each committed line contains the complete resulting state, a monotonically increasing revision and a checksum. A snapshot is a convenience projection, never the source of truth. A partial trailing write can be discarded; corruption of a committed line fails visibly. A checkout lock serializes mutations, and `expectedRevision` can reject stale callers. Crash recovery never assumes an existing lock is stale while its PID is alive.

A native/manual session points to at most one selected run. A run stores task revisions, plans, assignments, decisions, evidence and failed attempts. Resume explicitly moves a run to a new session; directory sharing does not imply ownership. Native parent interruption pauses a run but retains live child assignments until the parent confirms those agents stopped.

Plan versions validate criterion coverage and acyclic dependencies. One assignment per run and one builder per checkout simplify integration and event attribution. Assignment counts survive retries, reuse and resume. They are not token/billing accounting. The helper does not prevent root edits or other tools from bypassing these conventions.

## Verification

`verify` runs an argv array directly with a timeout, captures the exit code and limited output, and fingerprints code before/after. Fingerprints include HEAD plus tracked and unignored files, including untracked content and symlink targets. Ignored build products and the harness's state directory are excluded. A check that changes this code state cannot pass for the final state.

Completion requires all criteria to pass at the current task revision, plan version and code hash, a resolved route, a current plan, and no active assignment. Qualitative inspection evidence is explicitly attributed to the agent or user. Runtime command evidence can only be produced by `verify`. Evidence supports a completion claim; it does not prove that a poorly chosen acceptance criterion is sufficient.

Two failed fixes for the same normalized cause and check trigger expert routing. Initial failure is not a fix, duplicate evidence is rejected, and unchanged code cannot count as another fix. Expert decisions reset the failure window and may keep, patch or replace the plan, or request input.

## Native event adapter

Before native delegation, the root reserves an assignment. It passes the returned model/effort, a unique task name when supported, and an assignment marker in the message. The task name permits matching when a host exposes opaque message content. Known aliases include `spawn_agent`, `Agent` and the observed `collaborationspawn_agent` spelling. Canonical native task names and native UUIDs are stored separately.

`SubagentStart` supplies the observed model. A recorded PreToolUse and the sole pending spawn allow attribution when the native event reports `agent_type: default`. `SubagentStop` ingests a valid Result or leaves an expert Decision for the root. Invalid output gets at most one formatting continuation. The root's Stop event warns about outstanding work and does not create an unattended loop.

Hooks are a best-effort adapter. Unavailable/untrusted hooks require explicit helper calls. Unknown hook errors are reported and may leave enforcement unavailable. There is no guarantee that every native/MCP tool or model-internal call is intercepted. Host authorization remains in force.

## Distribution

The GitHub marketplace installs the plugin for the Codex user. Project setup creates namespaced profiles and local state, preserving user-edited files. A bundled script contains the runtime and Zod so consumers need only Node and Git.

OpenDock uses the same payload under `.codex/orchestrail`, project skill wrappers, profiles, and an AGENTS.md managed block. It relies on explicit helper calls and does not replace shared native hook configuration. Ownership of its copied files remains with OpenDock.

The current journal stores full state per event and is intended for bounded project runs. Long-lived large histories may need future compaction/migration work. There is no automatic journal pruning in this version.
