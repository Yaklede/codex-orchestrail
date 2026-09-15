import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Config, type Run } from '../packages/runtime/src/contracts.js';
import { execute, chooseRoute, getRun } from '../packages/runtime/src/engine.js';
import { exec, fingerprint, hash, readJson, recoverLock, writeJson } from '../packages/runtime/src/files.js';
import { setup, uninstall, doctor } from '../packages/runtime/src/install.js';
import { handleHook } from '../packages/runtime/src/hooks.js';
import { Store } from '../packages/runtime/src/store.js';

const roots: string[] = [];
const plugin = path.resolve('plugins/orchestrail');
const criteria = [{ id: 'AC-1', description: 'Feature works' }];
const plan = { summary: 'Implement the feature', invariants: ['Preserve the API'], steps: [{ id: 'step-1', objective: 'Implement', criteria: ['AC-1'], files: ['value.txt'] }] };
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrail test '))); roots.push(root);
  await exec('git', ['init', '-q', '-b', 'main', root]);
  await fs.writeFile(path.join(root, 'value.txt'), 'initial');
  await setup(root, plugin, { preset: 'balanced' });
  const store = new Store(root);
  const call = (action: string, input: Record<string, unknown> = {}, session = 'session-1') => execute(store, action, input, session);
  await call('start', { goal: 'Implement feature', criteria });
  await call('route', { kind: 'feature', reason: 'Existing pattern' });
  await call('plan', plan);
  return { root, store, call, run: async () => getRun(await store.load(), 'session-1') };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('end-to-end state and evidence', () => {
  test('Sol work completes only with evidence, then continues as a revised request', async () => {
    const { call, run } = await fixture();
    const a = await call('assign', { role: 'builder', objective: 'Implement', stepId: 'step-1' }) as any;
    await expect(call('complete')).rejects.toMatchObject({ code: 'INCOMPLETE' });
    const e = await call('verify', { criterionId: 'AC-1', description: 'Read feature', argv: [process.execPath, '-e', 'process.exit(0)'] }) as any;
    expect(e.passed).toBe(true);
    await call('result', { assignmentId: a.id, planVersion: 1, status: 'completed', summary: 'Done', evidenceIds: [e.id] });
    expect(await call('complete')).toMatchObject({ status: 'completed', usage: { expertAssignments: 0 } });
    await call('revise', { goal: 'Change the retry limit', criteria });
    expect((await run()).taskRevision).toBe(2);
    await expect(call('assign', { role: 'builder', objective: 'Update', stepId: 'step-1' })).rejects.toMatchObject({ code: 'ROUTE_REQUIRED' });
    await call('route', { kind: 'routine', reason: 'Small follow-up' });
    await call('plan', plan);
    await expect(call('complete')).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });
  test('changed code invalidates prior passing evidence, including untracked files', async () => {
    const { root, call } = await fixture();
    await call('verify', { criterionId: 'AC-1', description: 'Check', argv: [process.execPath, '-e', 'process.exit(0)'] });
    await fs.writeFile(path.join(root, 'new.txt'), 'new code');
    await expect(call('complete')).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });
  test('passing checks do not bypass an unresolved expert decision', async () => {
    const { call } = await fixture();
    await call('verify', { criterionId: 'AC-1', description: 'Check', argv: [process.execPath, '-e', 'process.exit(0)'] });
    await call('route', { kind: 'architecture', reason: 'Unresolved invariant' });
    await expect(call('complete')).rejects.toMatchObject({ code: 'INCOMPLETE' });
    const expert = await call('assign', { role: 'expert', objective: 'Resolve invariant' }) as any;
    await call('decision', { assignmentId: expert.id, outcome: 'KEEP_PLAN', summary: 'Invariant is preserved' });
    expect(await call('complete')).toMatchObject({ status: 'completed' });
  });
  test('a later failure invalidates an earlier pass even with unchanged code', async () => {
    const { call } = await fixture();
    await call('verify', { criterionId: 'AC-1', description: 'Health initially passes', argv: [process.execPath, '-e', 'process.exit(0)'] });
    await call('verify', { criterionId: 'AC-1', description: 'Health later fails', argv: [process.execPath, '-e', 'process.exit(1)'] });
    await expect(call('complete')).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });
  test('zero exit deployment does not override a failing health check', async () => {
    const { call } = await fixture();
    await call('revise', { goal: 'Deploy', criteria: [...criteria, { id: 'AC-2', description: 'Health check succeeds' }] });
    await call('route', { kind: 'deployment', reason: 'Verified procedure', runbook: 'Run deploy then health' });
    await call('plan', { ...plan, steps: [{ id: 'deploy', objective: 'Deploy and check', criteria: ['AC-1', 'AC-2'] }] });
    await call('verify', { criterionId: 'AC-1', description: 'Deploy fixture', argv: [process.execPath, '-e', 'process.exit(0)'] });
    const health = await call('verify', { criterionId: 'AC-2', description: 'Health fixture', argv: [process.execPath, '-e', 'process.exit(1)'] }) as any;
    expect(health.passed).toBe(false);
    await expect(call('complete')).rejects.toMatchObject({ code: 'INCOMPLETE' });
  });
  test('checks that change code cannot attest to the final state', async () => {
    const { call } = await fixture();
    const e = await call('verify', { criterionId: 'AC-1', description: 'Changing check', argv: [process.execPath, '-e', 'require("fs").writeFileSync("value.txt","changed")'] }) as any;
    expect(e).toMatchObject({ passed: false, workspaceChangedDuringCheck: true });
  });
  test('command evidence cannot be fabricated through the manual evidence operation', async () => {
    const { root, call } = await fixture();
    await expect(call('evidence', { criterionId: 'AC-1', kind: 'command', description: 'claim', passed: true, command: 'true', exitCode: 0, codeHash: (await fingerprint(root)).hash })).rejects.toMatchObject({ code: 'VERIFY_REQUIRED' });
  });
  test('cyclic, incomplete and stale plans are rejected', async () => {
    const { call } = await fixture();
    await expect(call('plan', { ...plan, steps: [{ id: 'a', objective: 'A', criteria: ['AC-1'], dependsOn: ['b'] }, { id: 'b', objective: 'B', criteria: ['AC-1'], dependsOn: ['a'] }] })).rejects.toMatchObject({ code: 'PLAN_CYCLE' });
    await expect(call('plan', { ...plan, steps: [{ id: 'a', objective: 'A', criteria: ['unknown'] }] })).rejects.toMatchObject({ code: 'UNKNOWN_CRITERION' });
    const a = await call('assign', { role: 'builder', objective: 'Implement', stepId: 'step-1' }) as any;
    await expect(call('plan', plan)).rejects.toMatchObject({ code: 'WRITER_ACTIVE' });
    await expect(call('result', { assignmentId: a.id, planVersion: 99, status: 'completed', summary: 'Wrong version' })).rejects.toMatchObject({ code: 'STALE_PLAN' });
  });
});

describe('routing and expert decisions', () => {
  test('two real failed fixes trigger expert routing, repeated logs do not', async () => {
    const { root, call, run } = await fixture();
    const verify = () => call('verify', { criterionId: 'AC-1', description: 'Failure', argv: [process.execPath, '-e', 'process.exit(1)'] }) as Promise<any>;
    const record = (e: any, fix?: string) => call('attempt', { criterionId: 'AC-1', evidenceId: e.id, cause: 'assertion failed', category: 'implementation', ...(fix ? { fixDescription: fix } : {}) });
    const first = await verify(); await record(first);
    await expect(record(first)).rejects.toMatchObject({ code: 'DUPLICATE_ATTEMPT' });
    await expect(record(await verify(), 'Only reran it')).rejects.toMatchObject({ code: 'NO_CODE_CHANGE' });
    await fs.writeFile(path.join(root, 'value.txt'), 'fix 1'); await record(await verify(), 'First fix');
    expect(chooseRoute(await run(), { kind: 'incident', reason: 'Fix' }, Config.parse({})).role).toBe('builder');
    await fs.writeFile(path.join(root, 'value.txt'), 'fix 2'); await record(await verify(), 'Second fix');
    expect(await call('route', { kind: 'incident', reason: 'Repeated failure' })).toMatchObject({ role: 'expert' });
    const expert = await call('assign', { role: 'expert', objective: 'Diagnose' }) as any;
    await call('decision', { assignmentId: expert.id, outcome: 'PATCH_PLAN', summary: 'Correct the invariant', plan });
    expect((await run()).plans).toHaveLength(2);
    expect(chooseRoute(await run(), { kind: 'incident', reason: 'Implement diagnosis' }, Config.parse({})).role).toBe('builder');
    expect(await call('assign', { role: 'builder', objective: 'Implement diagnosis', stepId: 'step-1' })).toMatchObject({ model: 'gpt-5.6-sol', planVersion: 2 });
  });
  test('routine deploy uses Sol, unresolved compatibility uses Astra, environmental failures wait', async () => {
    const { run, call } = await fixture(); const r = await run(); const c = Config.parse({});
    expect(chooseRoute(r, { kind: 'deployment', reason: 'Known', runbook: 'Deploy then health' }, c).role).toBe('builder');
    expect(chooseRoute(r, { kind: 'deployment', reason: 'Migration', runbook: 'Deploy', unresolvedDecisions: ['Old/new schema compatibility'] }, c).role).toBe('expert');
    expect(await call('route', { kind: 'incident', reason: 'Network unavailable', environmentBlocker: 'Needs access' })).toMatchObject({ role: null });
    expect((await run()).status).toBe('waiting_for_input');
    await expect(call('assign', { role: 'expert', objective: 'Try harder' })).rejects.toMatchObject({ code: 'RUN_NOT_ACTIVE' });
  });
  test('expert budgets count reused-agent assignments and do not reset on resume', async () => {
    const { root, store, call, run } = await fixture();
    await writeJson(path.join(root, '.orchestrail/config.json'), Config.parse({ limits: { expertAssignments: 1 } }));
    await call('route', { kind: 'architecture', reason: 'Decision needed' });
    const a = await call('assign', { role: 'expert', objective: 'Decide' }) as any;
    await call('decision', { assignmentId: a.id, outcome: 'KEEP_PLAN', summary: 'Keep it' });
    await call('pause', { reason: 'Pause' });
    await call('resume', { runId: (await run()).id });
    await call('route', { kind: 'architecture', reason: 'A new decision' });
    await expect(call('assign', { role: 'expert', objective: 'More decisions' })).rejects.toMatchObject({ code: 'EXPERT_LIMIT' });
    expect((await store.load()).runs[(await run()).id]!.assignments).toHaveLength(1);
  });
});

describe('recovery and ownership', () => {
  test('two sessions cannot own concurrent writers; read selectors do not guess', async () => {
    const { store, call } = await fixture();
    await call('assign', { role: 'builder', objective: 'Write', stepId: 'step-1' });
    await call('start', { goal: 'Other task', criteria }, 'session-2');
    await call('route', { kind: 'feature', reason: 'Existing pattern' }, 'session-2');
    await call('plan', plan, 'session-2');
    await expect(call('assign', { role: 'builder', objective: 'Conflicting write', stepId: 'step-1' }, 'session-2')).rejects.toMatchObject({ code: 'WRITER_ACTIVE' });
    expect((await execute(store, 'status', {})) as any).toHaveProperty('runs');
  });
  test('parent interrupt preserves live child ownership until explicitly stopped', async () => {
    const { store, root, call, run } = await fixture();
    const a = await call('assign', { role: 'builder', objective: 'Write', stepId: 'step-1' }) as any;
    await call('bind', { assignmentId: a.id, nativeAgentId: 'native-child' });
    await handleHook(store, { hook_event_name: 'Interrupt', session_id: 'session-1', cwd: root });
    expect((await run()).status).toBe('paused');
    await expect(call('resume', { runId: (await run()).id })).rejects.toMatchObject({ code: 'ASSIGNMENT_ACTIVE' });
    await expect(call('pause', { reason: 'Stop' })).rejects.toMatchObject({ code: 'STOP_AGENTS_FIRST' });
    await call('pause', { reason: 'Native child stopped', nativeAgentsStopped: true });
    await call('resume', { runId: (await run()).id });
    expect((await run()).status).toBe('active');
    await call('cancel', { reason: 'User cancelled' });
    await expect(call('resume', { runId: (await run()).id })).rejects.toMatchObject({ code: 'CANCELLED' });
  });
  test('partial final log is recovered and stale concurrent writes are rejected', async () => {
    const { store, call } = await fixture();
    const before = await store.load();
    await fs.appendFile(path.join(store.dir, 'events.jsonl'), '{"partial":');
    await fs.writeFile(path.join(store.dir, 'snapshot.json'), 'corrupt cache');
    expect((await store.load()).revision).toBe(before.revision);
    await call('pause', { reason: 'Checkpoint', expectedRevision: before.revision });
    await expect(call('resume', { runId: getRun(await store.load(), 'session-1').id, expectedRevision: before.revision })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    expect((await fs.readFile(path.join(store.dir, 'events.jsonl'), 'utf8')).endsWith('\n')).toBe(true);
    const writes = await Promise.allSettled([store.mutate('a', s => { s.sessions.a = {}; }, before.revision + 1), store.mutate('b', s => { s.sessions.b = {}; }, before.revision + 1)]);
    expect(writes.filter(w => w.status === 'fulfilled')).toHaveLength(1);
  });
  test('a committed corrupted record and live owner lock fail visibly', async () => {
    const { store } = await fixture();
    const file = path.join(store.dir, 'events.jsonl');
    await fs.appendFile(file, JSON.stringify({ revision: 999, state: {}, checksum: 'bad' }) + '\n');
    await expect(store.load()).rejects.toMatchObject({ code: 'CORRUPT_LOG' });
    await writeJson(path.join(store.dir, 'write.lock'), { pid: process.pid });
    await expect(recoverLock(store.dir)).rejects.toMatchObject({ code: 'LIVE_LOCK' });
  });
  test('setup is repeatable, preserves edits and uninstall removes only owned files', async () => {
    const { root } = await fixture();
    expect(await setup(root, plugin)).toMatchObject({ changed: [] });
    const changed = path.join(root, '.codex/agents/orchestrail-expert.toml');
    await fs.appendFile(changed, '\n# user customization\n');
    await expect(setup(root, plugin)).rejects.toMatchObject({ code: 'INSTALL_CONFLICT' });
    const removed = await uninstall(root);
    expect(removed.removed).toHaveLength(3); expect(removed.preserved).toEqual(['.codex/agents/orchestrail-expert.toml']);
    expect(await fs.readFile(changed, 'utf8')).toContain('user customization');
    expect(await readJson(path.join(root, '.orchestrail/config.json'))).toMatchObject({ schemaVersion: 1 });
  });
  test('managed symlinks are rejected before writes leave the project', async () => {
    const { root } = await fixture();
    await fs.rm(path.join(root, '.orchestrail'), { recursive: true });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrail outside ')); roots.push(outside);
    await fs.symlink(outside, path.join(root, '.orchestrail'), 'dir');
    await expect(setup(root, plugin)).rejects.toMatchObject({ code: 'SYMLINK_PATH' });
    expect(await fs.readdir(outside)).toEqual([]);
  });
});

describe('native hook contracts', () => {
  test('observed CLI aliases and opaque messages bind by task name, capture actual models and allow reserved follow-ups', async () => {
    const { root, store, call, run } = await fixture();
    const a = await call('assign', { role: 'scout', objective: 'Read' }) as any;
    const event = { hook_event_name: 'PreToolUse', session_id: 'session-1', cwd: root, turn_id: 'turn-1', tool_name: 'collaborationspawn_agent', tool_use_id: 'spawn-1', tool_input: { task_name: a.taskName, message: 'opaque-host-message', model: a.model, reasoning_effort: a.effort } };
    expect(await handleHook(store, { ...event, tool_input: { ...event.tool_input, task_name: 'unreserved' } })).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny');
    expect(await handleHook(store, event)).toEqual({});
    const taskName = `/root/${a.taskName}`;
    await handleHook(store, { ...event, hook_event_name: 'PostToolUse', tool_response: JSON.stringify({ task_name: taskName }) });
    await handleHook(store, { hook_event_name: 'SubagentStart', cwd: root, session_id: 'session-1', agent_id: 'native-uuid', agent_type: 'default', model: a.model });
    expect((await run()).assignments[0]).toMatchObject({ nativeTaskName: taskName, nativeAgentId: 'native-uuid', actualModel: a.model });
    await call('result', { assignmentId: a.id, planVersion: 1, status: 'completed', summary: 'Read the file' });
    const follow = await call('assign', { role: 'scout', objective: 'Read adjacent constraints' }) as any;
    const followEvent = { ...event, tool_name: 'collaborationfollowup_task', tool_use_id: 'follow-1', tool_input: { target: taskName, message: 'opaque-host-message' } };
    expect(await handleHook(store, followEvent)).toEqual({});
    expect((await run()).assignments.find(x => x.id === follow.id)).toMatchObject({ status: 'running', nativeTaskName: taskName, nativeAgentId: 'native-uuid' });
  });
  test('unreserved/wrong-model spawn is denied; repeated valid delivery is idempotent', async () => {
    const { root, store, call, run } = await fixture();
    const event = { hook_event_name: 'PreToolUse', session_id: 'session-1', cwd: root, turn_id: 'turn-1', tool_name: 'spawn_agent', tool_use_id: 'call-1', tool_input: { message: 'Work', model: 'gpt-5.6-sol', reasoning_effort: 'high' } };
    expect(await handleHook(store, event)).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny');
    const a = await call('assign', { role: 'builder', objective: 'Write', stepId: 'step-1' }) as any;
    event.tool_input.message = `[orchestrail:${a.id}] Work`;
    event.tool_input.model = 'gpt-6-astra';
    expect(await handleHook(store, event)).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny');
    event.tool_input.model = 'gpt-5.6-sol';
    expect(await handleHook(store, event)).toEqual({});
    expect(await handleHook(store, event)).toEqual({});
    expect((await run()).assignments).toHaveLength(1);
    await handleHook(store, { ...event, hook_event_name: 'PostToolUse', tool_response: { agent_id: 'child-1' } });
    expect((await run()).assignments[0]?.nativeAgentId).toBe('child-1');
  });
  test('startup restores run context and unknown sessions do not adopt another run', async () => {
    const { root, store } = await fixture();
    expect(await handleHook(store, { hook_event_name: 'SessionStart', source: 'compact', cwd: root, session_id: 'session-1', model: 'gpt-5.6-sol' })).toHaveProperty('hookSpecificOutput.additionalContext', expect.stringContaining('Implement feature'));
    const other = JSON.stringify(await handleHook(store, { hook_event_name: 'SessionStart', cwd: root, session_id: 'other' }));
    expect(other).not.toContain('Implement feature');
  });
  test('child result ingestion is idempotent and correction is bounded', async () => {
    const { root, store, call, run } = await fixture();
    const a = await call('assign', { role: 'builder', objective: 'Write', stepId: 'step-1' }) as any;
    await call('bind', { assignmentId: a.id, nativeAgentId: 'child' });
    const event = { hook_event_name: 'SubagentStop', session_id: 'session-1', cwd: root, turn_id: 't', agent_id: 'child', last_assistant_message: 'done' };
    expect(await handleHook(store, event)).toHaveProperty('decision', 'block');
    expect(await handleHook(store, { ...event, stop_hook_active: true })).not.toHaveProperty('decision');
    const result = { assignmentId: a.id, planVersion: 1, status: 'completed', summary: 'Done', evidenceIds: [], blockers: [] };
    await handleHook(store, { ...event, last_assistant_message: JSON.stringify(result) });
    await call('result', result);
    expect((await run()).assignments[0]?.status).toBe('completed');
  });
});

describe('direct execution and compact orchestration', () => {
  test('idle hooks and status do not require setup or create state', async () => {
    const { root, store } = await fixture();
    await fs.rm(store.dir, { recursive: true });
    for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'PostToolUse']) {
      expect(await handleHook(store, { hook_event_name, cwd: root, session_id: 'direct' })).toEqual({});
    }
    expect(await execute(store, 'status', {}, 'direct')).toMatchObject({ status: 'idle', run: null, controlRevision: 0 });
    await expect(fs.access(store.dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('observations preserve task revision guards; actual plan changes invalidate them', async () => {
    const { root, store, call } = await fixture();
    const before = await call('status') as any;
    await handleHook(store, { hook_event_name: 'PostToolUse', cwd: root, session_id: 'session-1', tool_name: 'apply_patch', tool_use_id: 'edit-1', tool_input: { patch: 'metadata observation' } });
    await handleHook(store, { hook_event_name: 'SessionStart', cwd: root, session_id: 'session-1', model: 'gpt-6-astra' });
    const after = await call('status') as any;
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(after.controlRevision).toBe(before.controlRevision);
    await expect(call('plan', { ...plan, expectedRevision: before.revision })).rejects.toMatchObject({ code: 'STALE_REVISION' });
    await call('plan', { ...plan, expectedControlRevision: before.controlRevision });
    await expect(call('pause', { reason: 'Old status', expectedControlRevision: before.controlRevision })).rejects.toMatchObject({ code: 'STALE_CONTROL_REVISION' });
  });
  test('legacy journals acquire control revisions without rewriting old events', async () => {
    const { store, root, call } = await fixture();
    const file = path.join(store.dir, 'events.jsonl');
    const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => {
      const event = JSON.parse(line); delete event.state.controlRevision;
      event.checksum = hash(JSON.stringify(event.state)); return JSON.stringify(event);
    }).join('\n') + '\n';
    await fs.writeFile(file, lines);
    const before = await call('status') as any;
    expect(before.controlRevision).toBe(before.revision);
    await handleHook(store, { hook_event_name: 'SessionStart', cwd: root, session_id: 'session-1' });
    await call('pause', { reason: 'Migration', expectedControlRevision: before.controlRevision });
    expect((await store.load()).controlRevision).toBe(before.controlRevision + 1);
    expect((await fs.readFile(file, 'utf8')).startsWith(lines)).toBe(true);
  });
  test('compact status retains current constraints and blockers without replaying history', async () => {
    const { store, call } = await fixture();
    const before = JSON.stringify(await call('status')).length;
    await store.mutate('diagnostics', state => {
      const run = getRun(state, 'session-1');
      run.observations = Array.from({ length: 40 }, () => ({ tool: 'exec_command', at: 'now', summary: 'private old output'.repeat(200) }));
      run.constraints = ['Preserve compatibility'];
      run.pauseReason = 'Database unavailable'; run.status = 'paused';
    });
    const compact = await call('status') as any;
    expect(compact.run.constraints).toEqual(['Preserve compatibility']);
    expect(compact.run.plan.invariants).toEqual(['Preserve the API']);
    expect(compact.run.plan.steps[0].objective).toBe('Implement');
    expect(compact.run.pauseReason).toBe('Database unavailable');
    expect(compact.verification.missing).toEqual(['AC-1']);
    expect(JSON.stringify(compact).length).toBeLessThan(before + 300);
    expect(JSON.stringify(compact)).not.toContain('private old output');
    expect((await call('status', { detail: true }) as any).run.observations).toHaveLength(40);
  });
  test('begin atomically starts, plans and reserves; invalid input leaves no run', async () => {
    const { call, store } = await fixture();
    const input = { goal: 'Bounded implementation', criteria, route: { kind: 'feature', reason: 'Main agent resolved the design' }, assignment: { role: 'builder', objective: 'Implement the decided design', stepId: 'implement' } };
    const before = await store.load();
    await expect(call('begin', { ...input, assignment: { ...input.assignment, stepId: 'unknown' } }, 'new-session')).rejects.toMatchObject({ code: 'UNKNOWN_STEP' });
    expect(await store.load()).toEqual(before);
    await expect(call('begin', { ...input, plan: { ...plan, steps: [{ ...plan.steps[0], dependsOn: ['step-1'] }] } }, 'new-session')).rejects.toMatchObject({ code: 'PLAN_CYCLE' });
    expect(await store.load()).toEqual(before);
    const result = await call('begin', input, 'new-session') as any;
    expect(result).toMatchObject({ planVersion: 1, assignment: { role: 'builder', model: 'gpt-5.6-sol', effort: 'high' } });
    expect((await store.load()).revision).toBe(before.revision + 1);
    expect((await store.load()).controlRevision).toBe(result.controlRevision);
  });
  test('finish verifies and completes in one call, and reuses existing evidence when no checks are requested', async () => {
    const { call } = await fixture();
    expect(await call('finish', { checks: [{ criterionId: 'AC-1', description: 'Assert feature exists', argv: [process.execPath, '-e', "require('node:assert/strict').equal(require('node:fs').readFileSync('value.txt','utf8'),'initial')"] }] })).toMatchObject({ completed: true, status: 'completed', checks: [{ passed: true }] });
    await call('begin', { goal: 'Tracked direct work', criteria, route: { kind: 'routine', reason: 'Direct execution' } });
    await call('verify', { criterionId: 'AC-1', description: 'Check', argv: [process.execPath, '-e', 'process.exit(0)'] });
    expect(await call('finish')).toMatchObject({ completed: true, checks: [] });
  });
  test('finish retains failed evidence, rejects active workers and cannot reuse stale evidence', async () => {
    const { call, root, run } = await fixture();
    expect(await call('finish', { checks: [{ criterionId: 'AC-1', description: 'Fails', argv: [process.execPath, '-e', 'process.exit(1)'] }] })).toMatchObject({ completed: false, status: 'active', checks: [{ passed: false }] });
    expect((await run()).evidence.at(-1)?.passed).toBe(false);
    await call('verify', { criterionId: 'AC-1', description: 'Check', argv: [process.execPath, '-e', 'process.exit(0)'] });
    await fs.writeFile(path.join(root, 'value.txt'), 'changed');
    expect(await call('finish')).toMatchObject({ completed: false, verification: { missing: ['AC-1'] } });
    await call('assign', { role: 'builder', objective: 'Write', stepId: 'step-1' });
    await expect(call('finish')).rejects.toMatchObject({ code: 'ASSIGNMENT_ACTIVE' });
  });
  test('finish validates every requested criterion and stale guard before any command runs', async () => {
    const { call, root } = await fixture();
    const check = { criterionId: 'AC-1', description: 'Must not execute', argv: [process.execPath, '-e', "require('node:fs').writeFileSync('side-effect.txt','ran')"] };
    const before = await call('status') as any;
    await call('plan', plan);
    await expect(call('finish', { checks: [check], expectedControlRevision: before.controlRevision })).rejects.toMatchObject({ code: 'STALE_CONTROL_REVISION' });
    await expect(call('finish', { checks: [check, { ...check, criterionId: 'unknown' }] })).rejects.toMatchObject({ code: 'UNKNOWN_CRITERION' });
    await expect(fs.access(path.join(root, 'side-effect.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
