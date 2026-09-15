import { z } from 'zod';
import { AttemptInput, Criterion, DecisionInput, EvidenceInput, HarnessError, Plan, Result, Role, RouteInput, ensure, id, type Assignment, type Config, type Evidence, type Run, type State } from './contracts.js';
import { exec, fingerprint, hash, now, redact, uid } from './files.js';
import { Store, controlRevision } from './store.js';

const StartInput = z.object({ goal: z.string().min(1).max(16000), constraints: z.array(z.string()).default([]), criteria: z.array(Criterion).min(1) }).strict();
const AssignmentInput = z.object({ role: Role, objective: z.string().min(1).max(16000), stepId: id.optional() }).strict();
const CheckInput = z.object({ criterionId: id, argv: z.array(z.string()).min(1).max(100), description: z.string().min(1).max(4000), timeoutMs: z.number().int().min(100).max(300000).default(120000) }).strict();

export const currentPlan = (run: Run) => run.plans.at(-1);
export const version = (run: Run) => currentPlan(run)?.version ?? 0;
export const inFlight = (a: Assignment) => ['reserved', 'running'].includes(a.status);
export function getRun(state: State, sessionId?: string, runId?: string): Run {
  const key = runId ?? (sessionId ? state.sessions[sessionId]?.runId : undefined);
  const run = key ? state.runs[key] : undefined;
  ensure(run, 'NO_ACTIVE_RUN', 'No run selected. Start a run, pass --session, or pass runId.');
  if (sessionId) ensure(run.sessionId === sessionId, 'SESSION_MISMATCH', 'Run belongs to a different session; use resume to attach it.');
  return run;
}
export function active(run: Run) { ensure(run.status === 'active', 'RUN_NOT_ACTIVE', `Run is ${run.status}: ${run.pauseReason ?? ''}`); }
function touch(run: Run) { run.updatedAt = now(); }
export function addPlan(run: Run, raw: unknown) {
  const plan = Plan.parse(raw);
  const ids = new Set(plan.steps.map(s => s.id));
  ensure(ids.size === plan.steps.length, 'DUPLICATE_STEP', 'Plan step IDs must be unique.');
  const criteria = new Set(run.criteria.map(c => c.id));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const visit = (stepId: string) => {
    ensure(!visiting.has(stepId), 'PLAN_CYCLE', 'Plan dependencies contain a cycle.');
    if (visited.has(stepId)) return;
    const step = plan.steps.find(s => s.id === stepId);
    ensure(step, 'MISSING_STEP', `Unknown dependency: ${stepId}`);
    visiting.add(stepId); step.dependsOn.forEach(visit); visiting.delete(stepId); visited.add(stepId);
    for (const criterion of step.criteria) ensure(criteria.has(criterion), 'UNKNOWN_CRITERION', `Unknown criterion: ${criterion}`);
  };
  plan.steps.forEach(s => visit(s.id));
  for (const criterion of criteria) ensure(plan.steps.some(s => s.criteria.includes(criterion)), 'UNCOVERED_CRITERION', `No step covers ${criterion}.`);
  ensure(!run.assignments.some(a => a.role === 'builder' && inFlight(a)), 'WRITER_ACTIVE', 'Finish or interrupt the current builder before replacing the plan.');
  run.plans.push({ ...plan, version: version(run) + 1, taskRevision: run.taskRevision, at: now() });
  touch(run);
  return currentPlan(run)!;
}
export function failedFixCount(run: Run) {
  const groups = new Map<string, Set<string>>();
  const resolvedAt = run.decisions.at(-1)?.at;
  for (const a of run.attempts) {
    if (a.taskRevision !== run.taskRevision || a.category !== 'implementation' || !a.fixDescription) continue;
    if (resolvedAt && a.at <= resolvedAt) continue;
    const set = groups.get(a.fingerprint) ?? new Set(); set.add(a.codeHash); groups.set(a.fingerprint, set);
  }
  return Math.max(0, ...[...groups.values()].map(s => s.size));
}
export function chooseRoute(run: Run, raw: unknown, config: Config) {
  const input = RouteInput.parse(raw);
  const reasons: string[] = [];
  let role: Role | null = 'builder';
  if (input.environmentBlocker) { role = null; reasons.push(input.environmentBlocker); }
  else {
    if (input.kind === 'greenfield' || input.kind === 'architecture') reasons.push(`New ${input.kind} decisions`);
    reasons.push(...input.unresolvedDecisions);
    if (failedFixCount(run) >= config.limits.failedFixAttempts) reasons.push(`${failedFixCount(run)} failed fixes for the same cause`);
    if (input.kind === 'deployment' && !input.runbook) reasons.push('Deployment procedure and recovery criteria need a decision');
    if (reasons.length) role = 'expert';
  }
  if (!reasons.length) reasons.push(input.reason);
  return { ...input, role, reasons, at: now(), taskRevision: run.taskRevision };
}
export function reserve(run: Run, state: State, config: Config, raw: unknown): Assignment {
  active(run);
  const input = AssignmentInput.parse(raw);
  const route = run.route;
  if (input.role !== 'scout') {
    ensure(route?.taskRevision === run.taskRevision, 'ROUTE_REQUIRED', 'Classify this task revision before assigning work.');
    ensure(route.role !== null, 'ENVIRONMENT_BLOCKED', 'Resolve the environment blocker first.');
  }
  if (input.role === 'expert') {
    ensure(route?.role === 'expert', 'EXPERT_REASON_REQUIRED', 'Record the unresolved decision or failed fixes before expert assignment.');
    ensure(run.assignments.filter(a => a.role === 'expert').length < config.limits.expertAssignments, 'EXPERT_LIMIT', 'Expert assignment limit reached. Pause and report the remaining decision.');
  }
  if (input.role === 'builder') {
    ensure(route?.role !== 'expert', 'DECISION_PENDING', 'Resolve the expert decision before implementation.');
    const plan = currentPlan(run);
    ensure(plan && plan.taskRevision === run.taskRevision, 'PLAN_REQUIRED', 'Save a plan for this task revision.');
    ensure(input.stepId, 'STEP_REQUIRED', 'Builder assignments need a plan step.');
    const step = plan.steps.find(s => s.id === input.stepId);
    ensure(step, 'UNKNOWN_STEP', 'Step is not in the current plan.');
    for (const dep of step.dependsOn) ensure(run.assignments.some(a => a.stepId === dep && a.planVersion === plan.version && a.status === 'completed'), 'DEPENDENCY_PENDING', `Finish ${dep} first.`);
    ensure(!Object.values(state.runs).some(r => r.assignments.some(a => a.role === 'builder' && inFlight(a))), 'WRITER_ACTIVE', 'This checkout already has an active writer.');
  }
  // Serial assignments keep hook attribution unambiguous across native tool versions.
  ensure(!run.assignments.some(inFlight), 'ASSIGNMENT_ACTIVE', 'Finish or interrupt the current assignment before reserving another.');
  const model = config.models[input.role];
  const assignmentId = uid('assignment');
  const assignment: Assignment = { id: assignmentId, taskName: `orchestrail_${assignmentId.replaceAll('-', '_')}`, ...input, model: model.model, effort: model.effort, planVersion: version(run), taskRevision: run.taskRevision, status: 'reserved', at: now() };
  run.assignments.push(assignment); touch(run); return assignment;
}
export function acceptResult(run: Run, raw: unknown) {
  const result = Result.parse(raw);
  const assignment = run.assignments.find(a => a.id === result.assignmentId);
  ensure(assignment, 'UNKNOWN_ASSIGNMENT', 'Unknown assignment.');
  if (assignment.result && JSON.stringify(assignment.result) === JSON.stringify(result)) return assignment;
  ensure(assignment.taskRevision === run.taskRevision && result.planVersion === assignment.planVersion && result.planVersion === version(run), 'STALE_PLAN', 'Result belongs to an older task or plan.');
  ensure(inFlight(assignment), 'ASSIGNMENT_FINISHED', 'Assignment is already finished.');
  for (const evidenceId of result.evidenceIds) ensure(run.evidence.some(e => e.id === evidenceId), 'UNKNOWN_EVIDENCE', `Missing evidence ${evidenceId}.`);
  assignment.result = result; assignment.status = result.status; touch(run); return assignment;
}
export function completion(run: Run, codeHash: string) {
  const missing = run.criteria.filter(c => {
    const latest = run.evidence.findLast(e => e.criterionId === c.id && e.planVersion === version(run) && e.taskRevision === run.taskRevision);
    return !latest?.passed || latest.codeHash !== codeHash;
  });
  const routePending = !run.route || run.route.taskRevision !== run.taskRevision || run.route.role === 'expert' || run.route.role === null;
  return { ready: missing.length === 0 && currentPlan(run)?.taskRevision === run.taskRevision && !routePending && !run.assignments.some(inFlight) && run.status === 'active', missing: missing.map(c => c.id), routePending, activeAssignments: run.assignments.filter(inFlight).map(a => a.id) };
}

function compactRun(run: Run) {
  const plan = currentPlan(run);
  return {
    id: run.id, sessionId: run.sessionId, goal: run.goal, constraints: run.constraints,
    status: run.status, taskRevision: run.taskRevision, pauseReason: run.pauseReason, resumeChanges: run.resumeChanges,
    plan,
    route: run.route && { role: run.route.role, reasons: run.route.reasons, taskRevision: run.route.taskRevision },
    criteria: run.criteria.map(c => {
      const e = run.evidence.findLast(e => e.criterionId === c.id && e.planVersion === version(run) && e.taskRevision === run.taskRevision);
      return { ...c, evidence: e && { id: e.id, passed: e.passed, codeHash: e.codeHash, source: e.source } };
    }),
    assignments: run.assignments.filter(inFlight),
    latestResult: run.assignments.findLast(a => a.result && a.taskRevision === run.taskRevision)?.result,
    latestDecision: run.decisions.at(-1) && { id: run.decisions.at(-1)!.id, outcome: run.decisions.at(-1)!.outcome, summary: run.decisions.at(-1)!.summary, planVersion: run.decisions.at(-1)!.planVersion },
    history: { plans: run.plans.length, assignments: run.assignments.length, evidence: run.evidence.length, observations: run.observations?.length ?? 0 },
  };
}

export async function execute(store: Store, action: string, raw: Record<string, unknown>, sessionId?: string): Promise<unknown> {
  const runId = raw.runId === undefined ? undefined : id.parse(raw.runId);
  const expectedRevision = raw.expectedRevision === undefined ? undefined : z.number().int().nonnegative().parse(raw.expectedRevision);
  const expectedControlRevision = raw.expectedControlRevision === undefined ? undefined : z.number().int().nonnegative().parse(raw.expectedControlRevision);
  const { runId: _runId, expectedRevision: _revision, expectedControlRevision: _controlRevision, ...input } = raw;
  if (action === 'status') {
    const request = z.object({ detail: z.boolean().default(false) }).strict().parse(input);
    const state = await store.load();
    const revisions = { revision: state.revision, controlRevision: controlRevision(state) };
    if (!runId && !sessionId) return { ...revisions, runs: Object.values(state.runs).map(r => ({ id: r.id, sessionId: r.sessionId, goal: r.goal, status: r.status, updatedAt: r.updatedAt })) };
    if (!runId && sessionId && !state.sessions[sessionId]?.runId) return { ...revisions, run: null, status: 'idle' };
    const run = getRun(state, sessionId, runId);
    return { ...revisions, run: request.detail ? run : compactRun(run), verification: completion(run, (await fingerprint(store.project)).hash), usage: request.detail ? usage(run) : compactUsage(run), session: state.sessions[run.sessionId], detailAvailable: true };
  }
  const config = await store.config();
  if (action === 'fingerprint') return fingerprint(store.project);
  if (action === 'packet') {
    const run = getRun(await store.load(), sessionId, runId);
    const packet = { runId: run.id, goal: run.goal, constraints: run.constraints, criteria: run.criteria, taskRevision: run.taskRevision, plan: currentPlan(run), route: run.route, decisions: run.decisions.slice(-3), attempts: run.attempts.slice(-5), evidence: run.evidence.slice(-5), assignment: run.assignments.at(-1), codeState: await fingerprint(store.project) };
    const full = JSON.stringify(packet, null, 2);
    // Always retain valid structured metadata. Only evidence output strings are truncated.
    for (const e of packet.evidence) e.output = e.output.slice(0, Math.max(128, Math.floor(config.limits.packetChars / 10)));
    return { packet, truncated: full.length > JSON.stringify(packet, null, 2).length, chars: JSON.stringify(packet).length, targetChars: config.limits.packetChars, note: 'Referenced evidence remains in the state store. Goal, criteria and plan are never silently truncated.' };
  }
  if (action === 'finish') {
    const request = z.object({ checks: z.array(CheckInput).max(20).default([]) }).strict().parse(input);
    const state = await store.load();
    const run = getRun(state, sessionId, runId); active(run);
    ensure(!run.assignments.some(inFlight), 'ASSIGNMENT_ACTIVE', 'Finish or interrupt native agents before final verification.');
    ensure(expectedRevision === undefined || expectedRevision === state.revision, 'STALE_REVISION', 'State changed before verification.');
    ensure(expectedControlRevision === undefined || expectedControlRevision === controlRevision(state), 'STALE_CONTROL_REVISION', 'Task state changed before verification.');
    for (const check of request.checks) ensure(run.criteria.some(c => c.id === check.criterionId), 'UNKNOWN_CRITERION', `Unknown criterion: ${check.criterionId}`);
    let revision = controlRevision(state);
    const checks = [];
    for (const check of request.checks) {
      const e = await execute(store, 'verify', { ...check, runId: run.id, expectedControlRevision: revision }, sessionId) as Evidence & { controlRevision: number };
      revision = e.controlRevision;
      checks.push({ id: e.id, criterionId: e.criterionId, passed: e.passed, exitCode: e.exitCode, ...(e.passed ? {} : { output: e.output }) });
      if (!e.passed) break;
    }
    const latest = getRun(await store.load(), sessionId, run.id);
    const verification = completion(latest, (await fingerprint(store.project)).hash);
    if (!verification.ready) return { runId: run.id, status: latest.status, completed: false, verification, checks, controlRevision: revision };
    const result = await execute(store, 'complete', { runId: run.id, expectedControlRevision: revision }, sessionId) as Record<string, unknown>;
    return { ...result, completed: true, checks };
  }
  if (action === 'verify') {
    const request = CheckInput.parse(input);
    const state = await store.load(); const run = getRun(state, sessionId, runId); active(run);
    ensure(expectedRevision === undefined || expectedRevision === state.revision, 'STALE_REVISION', 'State changed before verification.');
    ensure(expectedControlRevision === undefined || expectedControlRevision === controlRevision(state), 'STALE_CONTROL_REVISION', 'Task state changed before verification.');
    ensure(run.criteria.some(c => c.id === request.criterionId), 'UNKNOWN_CRITERION', 'Unknown criterion.');
    const before = await fingerprint(store.project);
    let exitCode: number | null = 0, output = '';
    try { const result = await exec(request.argv[0]!, request.argv.slice(1), { cwd: store.project, timeout: request.timeoutMs, maxBuffer: 2 * 1024 * 1024 }); output = result.stdout + result.stderr; }
    catch (error) { const e = error as { code?: number; stdout?: string; stderr?: string; message: string }; exitCode = typeof e.code === 'number' ? e.code : null; output = (e.stdout ?? '') + (e.stderr ?? '') + '\n' + e.message; }
    const after = await fingerprint(store.project);
    return store.mutate('verified', s => {
      const target = getRun(s, sessionId, runId); active(target);
      ensure(target.taskRevision === run.taskRevision && version(target) === version(run), 'STALE_PLAN', 'Plan changed during verification; rerun the check.');
      const evidence = { id: uid('evidence'), criterionId: request.criterionId, description: request.description, kind: 'command' as const, command: JSON.stringify(request.argv), exitCode, passed: exitCode === 0 && before.hash === after.hash, output: redact(output).slice(-16000), codeHash: before.hash, source: 'runtime' as const, at: now(), planVersion: version(target), taskRevision: target.taskRevision };
      target.evidence.push(evidence); touch(target); return { ...evidence, workspaceChangedDuringCheck: before.hash !== after.hash, controlRevision: controlRevision(s) + 1 };
    }, undefined, expectedControlRevision);
  }
  const currentCode = ['start', 'begin', 'evidence', 'complete', 'resume', 'revise'].includes(action) ? await fingerprint(store.project) : undefined;
  return store.mutate(action, async state => {
    if (action === 'start' || action === 'begin') {
      const begin = action === 'begin'
        ? StartInput.extend({ route: RouteInput, plan: Plan.optional(), assignment: AssignmentInput.optional() }).parse(input)
        : undefined;
      const request = begin ?? StartInput.parse(input);
      ensure(new Set(request.criteria.map(c => c.id)).size === request.criteria.length, 'DUPLICATE_CRITERION', 'Criterion IDs must be unique.');
      const sid = id.parse(sessionId ?? uid('manual'));
      const previous = state.sessions[sid]?.runId;
      ensure(!previous || ['completed', 'cancelled'].includes(state.runs[previous]!.status), 'ACTIVE_RUN_EXISTS', 'Resume or cancel the existing run before starting another.');
      const run: Run = { id: uid('run'), sessionId: sid, goal: request.goal, constraints: request.constraints, criteria: request.criteria, taskRevision: 1, status: 'active', createdAt: now(), updatedAt: now(), baseline: currentCode!, plans: [], assignments: [], evidence: [], decisions: [], attempts: [] };
      state.runs[run.id] = run; state.sessions[sid] = { ...state.sessions[sid], runId: run.id };
      if (begin) {
        const currentConfig = await store.config();
        run.route = chooseRoute(run, begin.route, currentConfig);
        if (!run.route.role) { run.status = 'waiting_for_input'; run.pauseReason = run.route.environmentBlocker; }
        addPlan(run, begin.plan ?? { summary: run.goal, invariants: run.constraints, steps: [{ id: 'implement', objective: run.goal, criteria: run.criteria.map(c => c.id) }] });
        const assignment = begin.assignment ? reserve(run, state, currentConfig, begin.assignment) : undefined;
        return { runId: run.id, sessionId: sid, status: run.status, planVersion: version(run), controlRevision: controlRevision(state) + 1, assignment };
      }
      return run;
    }
    if (action === 'resume') {
      ensure(runId, 'RUN_ID_REQUIRED', 'Resume requires runId.');
      const run = getRun(state, undefined, runId);
      ensure(run.status !== 'cancelled', 'CANCELLED', 'Cancelled runs cannot be resumed; start a new run.');
      ensure(!run.assignments.some(inFlight), 'ASSIGNMENT_ACTIVE', 'Interrupt active native agents and record pause before resuming.');
      const sid = id.parse(sessionId ?? run.sessionId);
      const other = state.sessions[sid]?.runId;
      ensure(!other || other === run.id || ['completed', 'cancelled'].includes(state.runs[other]!.status), 'ACTIVE_RUN_EXISTS', 'Destination session already has an active run.');
      if (run.sessionId !== sid && state.sessions[run.sessionId]?.runId === run.id) delete state.sessions[run.sessionId]!.runId;
      state.sessions[sid] = { ...state.sessions[sid], runId: run.id }; run.sessionId = sid;
      if (run.baseline.hash !== currentCode!.hash) run.resumeChanges = { previous: run.baseline.hash, current: currentCode!.hash, at: now() };
      ensure(run.status !== 'completed', 'ALREADY_COMPLETED', 'Use revise for a follow-up change to a completed run.');
      run.status = 'active'; delete run.pauseReason; touch(run); return run;
    }
    const run = getRun(state, sessionId, runId);
    if (action === 'pause' || action === 'cancel') {
      const request = z.object({ reason: z.string().min(1).max(4000), nativeAgentsStopped: z.boolean().default(false) }).strict().parse(input);
      ensure(!run.assignments.some(a => a.status === 'running') || request.nativeAgentsStopped, 'STOP_AGENTS_FIRST', 'Interrupt native agents before releasing their assignments.');
      run.status = action === 'cancel' ? 'cancelled' : 'paused'; run.pauseReason = request.reason;
      run.assignments.filter(inFlight).forEach(a => { a.status = 'interrupted'; }); touch(run); return run;
    }
    if (action === 'revise') {
      const request = z.object({ goal: z.string().min(1).max(16000), criteria: z.array(Criterion).min(1), constraints: z.array(z.string()).default([]) }).strict().parse(input);
      ensure(run.status !== 'cancelled', 'CANCELLED', 'Start a new run after cancellation.');
      ensure(!run.assignments.some(inFlight), 'ASSIGNMENT_ACTIVE', 'Finish or interrupt active assignments before revising.');
      ensure(new Set(request.criteria.map(c => c.id)).size === request.criteria.length, 'DUPLICATE_CRITERION', 'Criterion IDs must be unique.');
      Object.assign(run, request, { taskRevision: run.taskRevision + 1, status: 'active', baseline: currentCode! }); delete run.route; delete run.pauseReason; touch(run); return run;
    }
    active(run);
    if (action === 'route') { run.route = chooseRoute(run, input, await store.config()); if (!run.route.role) { run.status = 'waiting_for_input'; run.pauseReason = run.route.environmentBlocker; } touch(run); return run.route; }
    if (action === 'plan') return addPlan(run, input);
    if (action === 'assign') return reserve(run, state, await store.config(), input);
    if (action === 'bind') {
      const request = z.object({ assignmentId: id, nativeAgentId: id.optional(), nativeTaskName: z.string().min(1).max(500).optional(), actualModel: z.string().optional() }).strict().parse(input);
      ensure(request.nativeAgentId || request.nativeTaskName, 'AGENT_ID_REQUIRED', 'Provide the actual native agent ID or canonical task name from the tool response.');
      const a = run.assignments.find(a => a.id === request.assignmentId);
      ensure(a && inFlight(a), 'UNKNOWN_ASSIGNMENT', 'Select a pending assignment.');
      ensure(!request.nativeAgentId || !a.nativeAgentId || a.nativeAgentId === request.nativeAgentId, 'AGENT_MISMATCH', 'Assignment already bound to a different agent.');
      ensure(!request.nativeTaskName || !a.nativeTaskName || a.nativeTaskName === request.nativeTaskName, 'AGENT_MISMATCH', 'Assignment already bound to a different task.');
      if (request.nativeAgentId) a.nativeAgentId = request.nativeAgentId;
      if (request.nativeTaskName) a.nativeTaskName = request.nativeTaskName;
      if (request.actualModel) a.actualModel = request.actualModel; a.status = 'running'; touch(run); return a;
    }
    if (action === 'result') return acceptResult(run, input);
    if (action === 'evidence') {
      const evidence = EvidenceInput.parse(input);
      ensure(evidence.source !== 'runtime', 'RESERVED_SOURCE', 'Use verify for runtime-observed evidence.');
      ensure(evidence.kind !== 'command' || !evidence.passed, 'VERIFY_REQUIRED', 'Successful command evidence must be recorded by verify.');
      ensure(evidence.codeHash === currentCode!.hash, 'STALE_EVIDENCE', 'Workspace changed. Inspect it again before recording evidence.');
      ensure(run.criteria.some(c => c.id === evidence.criterionId), 'UNKNOWN_CRITERION', 'Unknown criterion.');
      const item = { ...evidence, output: redact(evidence.output), id: uid('evidence'), at: now(), planVersion: version(run), taskRevision: run.taskRevision };
      run.evidence.push(item); touch(run); return item;
    }
    if (action === 'attempt') {
      const request = AttemptInput.parse(input);
      const evidence = run.evidence.find(e => e.id === request.evidenceId);
      ensure(evidence && !evidence.passed && evidence.criterionId === request.criterionId && evidence.taskRevision === run.taskRevision, 'FAILURE_REQUIRED', 'Select failed evidence for this criterion and task revision.');
      ensure(!run.attempts.some(a => a.evidenceId === evidence.id), 'DUPLICATE_ATTEMPT', 'This failure has already been recorded.');
      const normalized = request.cause.replace(/\b\d{4}-\d\d-\d\dT[\d:.Z+-]+/g, '<time>').replace(/\s+/g, ' ').trim();
      const fp = hash(`${request.criterionId}\0${evidence.command ?? 'inspection'}\0${normalized}`);
      const previous = run.attempts.filter(a => a.fingerprint === fp && a.taskRevision === run.taskRevision);
      if (request.fixDescription) ensure(previous.length && previous.every(a => a.codeHash !== evidence.codeHash), 'NO_CODE_CHANGE', 'A fix attempt needs an earlier failure and a new code state. Re-running a command is not a fix.');
      const item = { ...request, id: uid('attempt'), at: now(), fingerprint: fp, codeHash: evidence.codeHash, taskRevision: run.taskRevision };
      run.attempts.push(item); touch(run); return { attempt: item, failedFixes: failedFixCount(run) };
    }
    if (action === 'decision') {
      const request = DecisionInput.parse(input);
      const a = run.assignments.find(a => a.id === request.assignmentId);
      ensure(a?.role === 'expert' && a.taskRevision === run.taskRevision && a.planVersion === version(run), 'EXPERT_ASSIGNMENT_REQUIRED', 'Use the current expert assignment.');
      ensure(!run.decisions.some(d => d.assignmentId === a.id), 'DUPLICATE_DECISION', 'This expert assignment already produced a decision.');
      ensure(inFlight(a) || a.status === 'completed', 'ASSIGNMENT_FINISHED', 'This expert assignment was interrupted or failed.');
      if (request.outcome === 'PATCH_PLAN' || request.outcome === 'REPLAN') {
        ensure(request.plan, 'PLAN_REQUIRED', 'A changed decision must include its new plan.');
        if (request.outcome === 'REPLAN') ensure(run.decisions.filter(d => d.outcome === 'REPLAN').length < config.limits.replans, 'REPLAN_LIMIT', 'Replan limit reached.');
        addPlan(run, request.plan);
      } else ensure(!request.plan, 'UNEXPECTED_PLAN', 'Only PATCH_PLAN or REPLAN accepts a plan.');
      a.status = 'completed';
      const decision = { ...request, id: uid('decision'), at: now(), planVersion: version(run) }; run.decisions.push(decision);
      if (request.outcome === 'NEEDS_INPUT') { run.status = 'waiting_for_input'; run.pauseReason = request.summary; }
      else if (run.route) { run.route.role = 'builder'; run.route.reasons = [request.summary]; }
      touch(run); return decision;
    }
    if (action === 'complete') {
      const check = completion(run, currentCode!.hash);
      ensure(check.ready, 'INCOMPLETE', `Missing criteria: ${check.missing.join(', ') || 'none'}; pending assignments: ${check.activeAssignments.join(', ') || 'none'}; decision pending: ${check.routePending}; a current plan is required.`);
      run.status = 'completed'; touch(run); return { runId: run.id, status: run.status, criteria: run.criteria.map(c => c.id), codeHash: currentCode!.hash, usage: usage(run) };
    }
    throw new HarnessError('UNKNOWN_ACTION', `Unknown action: ${action}`);
  }, expectedRevision, expectedControlRevision);
}
function compactUsage(run: Run) {
  const counts = new Map<string, { requested: string; actual: string | null; effort: string; assignments: number }>();
  for (const a of run.assignments) {
    const key = JSON.stringify([a.model, a.actualModel ?? null, a.effort]);
    const group = counts.get(key) ?? { requested: a.model, actual: a.actualModel ?? null, effort: a.effort, assignments: 0 };
    group.assignments++; counts.set(key, group);
  }
  return { assignments: run.assignments.length, expertAssignments: run.assignments.filter(a => a.role === 'expert').length, models: [...counts.values()], tokens: null, cost: null };
}
export function usage(run: Run) {
  return { assignments: run.assignments.length, expertAssignments: run.assignments.filter(a => a.role === 'expert').length, models: run.assignments.map(a => ({ assignmentId: a.id, requested: a.model, actual: a.actualModel ?? null, effort: a.effort })), tokens: null, cost: null, coverage: 'Assignments only; native model-internal requests and account billing are not measured.' };
}
