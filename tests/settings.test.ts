import { afterEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setup, configure, doctor, uninstall } from '../packages/runtime/src/install.js';
import { settings } from '../packages/runtime/src/settings.js';
import { exec, readJson } from '../packages/runtime/src/files.js';
import { Store } from '../packages/runtime/src/store.js';
import { execute, getRun } from '../packages/runtime/src/engine.js';
import { handleHook } from '../packages/runtime/src/hooks.js';

const roots: string[] = [];
const plugin = path.resolve('plugins/orchestrail');
async function fixture(initialized = true) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrail settings '))); roots.push(root);
  await exec('git', ['init', '-q', '-b', 'main', root]);
  if (initialized) await setup(root, plugin, { preset: 'balanced', limits: { expertAssignments: 2 } });
  return root;
}
async function activeRun(root: string) {
  const store = new Store(root);
  const call = (action: string, input: Record<string, unknown> = {}) => execute(store, action, input, 'settings-session');
  await call('start', { goal: 'Implement feature', criteria: [{ id: 'AC-1', description: 'Feature works' }] });
  await call('route', { kind: 'feature', reason: 'Known implementation' });
  await call('plan', { summary: 'Implement', steps: [{ id: 'step-1', objective: 'Implement', criteria: ['AC-1'] }] });
  return { store, call, run: async () => getRun(await store.load(), 'settings-session') };
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

describe('preference onboarding', () => {
  test('an unanswered first setup does not write configuration or profiles', async () => {
    const root = await fixture(false);
    expect(await setup(root, plugin)).toMatchObject({ installed: false, configured: false, needsPreferences: true });
    await expect(fs.access(path.join(root, '.orchestrail'))).rejects.toThrow();
    await expect(fs.access(path.join(root, '.codex'))).rejects.toThrow();
    expect(await doctor(root, plugin)).toMatchObject({ configured: false, ready: false });
  });
  test('explicit custom preferences override a preset and survive setup repair', async () => {
    const root = await fixture(false);
    const input = { preset: 'all-medium', models: { builder: { effort: 'xhigh' }, expert: { model: 'gpt-6-astra', effort: 'ultra' } } };
    expect(await setup(root, plugin, input)).toMatchObject({ installed: true, needsPreferences: false, config: { models: { scout: { effort: 'medium' }, builder: { effort: 'xhigh' }, expert: { effort: 'ultra' } } } });
    const before = await settings(root);
    expect(await setup(root, plugin)).toMatchObject({ installed: true, changed: [], configHash: before.configHash });
    expect(await doctor(root, plugin)).toMatchObject({ ready: true });
    expect(await fs.readFile(path.join(root, '.codex/agents/orchestrail-expert.toml'), 'utf8')).toContain('model_reasoning_effort = "ultra"');
  });
  test('a clear partial first preference is sufficient and invalid choices do not initialize', async () => {
    const root = await fixture(false);
    await expect(setup(root, plugin, { models: { builder: { effort: 'hihg' } } })).rejects.toThrow();
    await expect(fs.access(path.join(root, '.orchestrail'))).rejects.toThrow();
    expect(await setup(root, plugin, { models: { builder: { effort: 'medium' } } })).toMatchObject({ installed: true, config: { models: { builder: { effort: 'medium' }, expert: { effort: 'high' } } } });
  });
});

describe('later preference changes', () => {
  test('partial model/effort changes preserve other roles, limits and existing assignments', async () => {
    const root = await fixture();
    const { call, store, run } = await activeRun(root);
    const a = await call('assign', { role: 'builder', objective: 'Implement', stepId: 'step-1' }) as any;
    await call('bind', { assignmentId: a.id, nativeAgentId: 'native-builder' });
    const state = await store.load();
    const prior = await settings(root);
    const changed = await configure(root, plugin, { models: { builder: { model: 'gpt-5.6-terra', effort: 'medium' } }, expectedConfigHash: prior.configHash });
    expect(changed).toMatchObject({ changedRoles: ['builder'], appliesTo: 'new assignments', mainConversationChanged: false, unchangedAssignments: [{ id: a.id, model: 'gpt-5.6-sol', effort: 'high', status: 'running' }] });
    expect(changed.config.models.expert).toEqual(prior.config.models.expert);
    expect(changed.config.limits).toEqual(prior.config.limits);
    expect(await store.load()).toEqual(state);
    await call('result', { assignmentId: a.id, planVersion: 1, status: 'completed', summary: 'Done' });
    expect(await call('assign', { role: 'builder', objective: 'Next change', stepId: 'step-1' })).toMatchObject({ model: 'gpt-5.6-terra', effort: 'medium' });
    expect((await run()).plans).toHaveLength(1);
    expect(await doctor(root, plugin)).toMatchObject({ ready: true });
  });
  test('a preset affects effort only and explicit overrides remain more specific', async () => {
    const root = await fixture();
    await configure(root, plugin, { models: { expert: { model: 'gpt-5.6-sol', effort: 'max' } } });
    const updated = await configure(root, plugin, { preset: 'all-medium', models: { reviewer: { effort: 'high' } } });
    expect(updated.config.models.expert).toEqual({ model: 'gpt-5.6-sol', effort: 'medium' });
    expect(updated.config.models.reviewer.effort).toBe('high');
    expect(updated.config.limits.expertAssignments).toBe(2);
  });
  test('stale, invalid and empty updates preserve saved preferences', async () => {
    const root = await fixture();
    const before = await settings(root);
    await expect(configure(root, plugin, { models: { expert: { effort: 'ultra' } }, expectedConfigHash: 'outdated' })).rejects.toMatchObject({ code: 'STALE_CONFIG' });
    await expect(configure(root, plugin, { models: { expert: { effrot: 'high' } } })).rejects.toThrow();
    await expect(configure(root, plugin, {})).rejects.toMatchObject({ code: 'SETTINGS_REQUIRED' });
    expect(await settings(root)).toEqual(before);
    const empty = await fixture(false);
    await expect(configure(empty, plugin, { preset: 'all-high' })).rejects.toMatchObject({ code: 'SETUP_REQUIRED' });
    await expect(fs.access(path.join(empty, '.orchestrail'))).rejects.toThrow();
  });
  test('custom instructions and inline comments survive a model/effort change without acquiring ownership', async () => {
    const root = await fixture();
    const file = path.join(root, '.codex/agents/orchestrail-builder.toml');
    const original = await fs.readFile(file, 'utf8');
    const custom = original.replace('model = "gpt-5.6-sol"', 'model = "gpt-5.6-sol" # team model').replace('Implement the assigned', 'Keep our team invariant. Implement the assigned') + '\n# our comment\n';
    await fs.writeFile(file, custom);
    await configure(root, plugin, { models: { builder: { model: 'gpt-5.6-terra', effort: 'medium' } } });
    expect(await fs.readFile(file, 'utf8')).toBe(custom.replace('model = "gpt-5.6-sol"', 'model = "gpt-5.6-terra"').replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "medium"'));
    const removed = await uninstall(root);
    expect(removed.preserved).toEqual(['.codex/agents/orchestrail-builder.toml']);
  });
  test('an unsupported profile header fails before changing any profile or configuration', async () => {
    const root = await fixture();
    const expert = path.join(root, '.codex/agents/orchestrail-expert.toml');
    await fs.writeFile(expert, (await fs.readFile(expert, 'utf8')).replace('model_reasoning_effort = "high"\n', ''));
    const before = await settings(root);
    const scout = path.join(root, '.codex/agents/orchestrail-scout.toml');
    const originalScout = await fs.readFile(scout, 'utf8');
    await expect(configure(root, plugin, { preset: 'all-medium', models: { scout: { effort: 'high' } } })).rejects.toMatchObject({ code: 'PROFILE_FORMAT_UNSUPPORTED' });
    expect(await settings(root)).toEqual(before);
    expect(await fs.readFile(scout, 'utf8')).toBe(originalScout);
  });
  test('a failed config write restores earlier profile and ownership writes', async () => {
    const root = await fixture();
    const files = ['.orchestrail/config.json', '.orchestrail/install-manifest.json', '.codex/agents/orchestrail-builder.toml'];
    const before = await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')));
    const rename = fs.rename.bind(fs); let failed = false;
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (to === path.join(root, '.orchestrail/config.json') && !failed) { failed = true; throw new Error('simulated I/O failure'); }
      return rename(from, to);
    });
    await expect(configure(root, plugin, { models: { builder: { effort: 'medium' } } })).rejects.toThrow('simulated I/O failure');
    expect(await Promise.all(files.map(file => fs.readFile(path.join(root, file), 'utf8')))).toEqual(before);
  });
  test('concurrent updates from the same config version do not overwrite each other', async () => {
    const root = await fixture(); const before = await settings(root);
    const updates = await Promise.allSettled([
      configure(root, plugin, { models: { builder: { effort: 'medium' } }, expectedConfigHash: before.configHash }),
      configure(root, plugin, { models: { expert: { effort: 'max' } }, expectedConfigHash: before.configHash }),
    ]);
    expect(updates.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(updates.find(r => r.status === 'rejected')).toMatchObject({ reason: { code: 'STALE_CONFIG' } });
    expect(await doctor(root, plugin)).toMatchObject({ ready: true });
  });
});

describe('native settings boundaries', () => {
  test.each([{ effort: 'medium' }, { model: 'gpt-5.6-terra' }])('changed settings require a fresh agent: %j', async patch => {
    const root = await fixture(); const { call, store } = await activeRun(root);
    const a = await call('assign', { role: 'builder', objective: 'First', stepId: 'step-1' }) as any;
    await call('bind', { assignmentId: a.id, nativeAgentId: 'old-builder' });
    await call('result', { assignmentId: a.id, planVersion: 1, status: 'completed', summary: 'First done' });
    await configure(root, plugin, { models: { builder: patch } });
    const next = await call('assign', { role: 'builder', objective: 'Next', stepId: 'step-1' }) as any;
    const event = { hook_event_name: 'PreToolUse', cwd: root, session_id: 'settings-session', tool_name: 'collaborationfollowup_task', tool_use_id: 'follow-1', tool_input: { target: 'old-builder', message: `[orchestrail:${next.id}] Continue` } };
    expect(await handleHook(store, event)).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny');
    expect(await handleHook(store, { ...event, tool_name: 'collaborationspawn_agent', tool_use_id: 'spawn-2', tool_input: { task_name: next.taskName, model: next.model, reasoning_effort: next.effort, message: 'opaque-message' } })).toEqual({});
  });
  test('old reservations keep explicit parameters while a changed named profile is rejected', async () => {
    const root = await fixture(); const { call, store } = await activeRun(root);
    const a = await call('assign', { role: 'builder', objective: 'Reserved', stepId: 'step-1' }) as any;
    await configure(root, plugin, { models: { builder: { effort: 'medium' } } });
    const base = { hook_event_name: 'PreToolUse', cwd: root, session_id: 'settings-session', tool_name: 'spawn_agent', tool_use_id: 'spawn', tool_input: { task_name: a.taskName, agent_type: 'orchestrail-builder' } };
    expect(await handleHook(store, base)).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny');
    expect(await handleHook(store, { ...base, tool_input: { task_name: a.taskName, model: a.model } })).toHaveProperty('hookSpecificOutput.permissionDecision', 'deny');
    expect(await handleHook(store, { ...base, tool_input: { task_name: a.taskName, model: a.model, reasoning_effort: a.effort } })).toEqual({});
    expect((await readJson(path.join(root, '.orchestrail/config.json'))).models.builder.effort).toBe('medium');
  });
});
