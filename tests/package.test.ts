import { afterEach, beforeAll, expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { exec } from '../packages/runtime/src/files.js';

const roots: string[] = [];
async function temporary() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrail package ')));
  roots.push(root); return root;
}
async function gitProject(root: string) { await fs.mkdir(root, { recursive: true }); await exec('git', ['init', '-q', '-b', 'main', root]); }
async function cli(runtime: string, project: string, action: string, input: unknown = {}) {
  const file = path.join(project, '.orchestrail-request.json');
  await fs.writeFile(file, JSON.stringify(input));
  try {
    const result = await exec(process.execPath, [runtime, action, '--project', project, '--session', 'bundle-session', '--input', file]);
    return JSON.parse(result.stdout);
  } finally { await fs.rm(file); }
}
beforeAll(async () => { await exec(process.execPath, ['scripts/prepare-opendock.mjs']); });
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });

test('the copied plugin works without source files or node_modules and with spaces in paths', async () => {
  const root = await temporary();
  const plugin = path.join(root, 'installed plugin');
  const project = path.join(root, 'user project'); await gitProject(project);
  await fs.cp('plugins/orchestrail', plugin, { recursive: true });
  const runtime = path.join(plugin, 'scripts/orchestrail.mjs');
  const version = JSON.parse(await fs.readFile('package.json', 'utf8')).version;
  expect((await exec(process.execPath, [runtime, '--version'])).stdout.trim()).toBe(version);
  expect(await cli(runtime, project, 'setup')).toMatchObject({ installed: true });
  expect(await cli(runtime, project, 'doctor')).toMatchObject({ ready: true, version });
  const run = await cli(runtime, project, 'start', { goal: 'Read a packaged fixture', criteria: [{ id: 'AC-1', description: 'Fixture works' }] });
  expect(run.sessionId).toBe('bundle-session');
  const hook = await cli(runtime, project, 'hook', { hook_event_name: 'SessionStart', cwd: project, session_id: 'bundle-session', source: 'compact' });
  expect(hook.hookSpecificOutput.additionalContext).toContain(run.id);
  expect(await fs.readFile(path.join(plugin, 'THIRD_PARTY_NOTICES.md'), 'utf8')).toContain('Colin McDonnell');
  expect(await fs.readFile(path.join(plugin, 'LICENSE'), 'utf8')).toContain('MIT License');
});

test('OpenDock maps a standalone project workflow with valid skill references and no shared hook replacement', async () => {
  const source = path.resolve('dist/opendock');
  const manifest = parse(await fs.readFile(path.join(source, 'dock.yml'), 'utf8'));
  expect(manifest.opendock).toBe(1);
  expect(manifest.requires.runtimes.node).toBe('>=22.0.0');
  const project = await temporary(); await gitProject(project);
  await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  const sharedHooks = '{"hooks":{"SessionStart":[]}}\n';
  await fs.writeFile(path.join(project, '.codex/hooks.json'), sharedHooks);
  for (const mapping of manifest.files) {
    expect(mapping.from).not.toContain('..'); expect(mapping.to).not.toContain('..');
    expect(path.isAbsolute(mapping.to)).toBe(false);
    const target = path.join(project, mapping.to);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(source, mapping.from), target, { recursive: true });
  }
  for (const name of ['orchestrail', 'orchestrail-setup', 'orchestrail-status', 'orchestrail-resume']) {
    const file = path.join(project, '.codex/skills', name, 'SKILL.md');
    const content = await fs.readFile(file, 'utf8');
    expect(parse(content.match(/^---\n([\s\S]*?)\n---/)![1]!).name).toBe(name);
    const target = path.resolve(path.dirname(file), content.match(/\]\(([^)]+)\)/)![1]!);
    expect(await fs.readFile(target, 'utf8')).toContain(`name: ${name}`);
  }
  const runtime = path.join(project, '.codex/orchestrail/scripts/orchestrail.mjs');
  expect(await cli(runtime, project, 'setup')).toMatchObject({ installed: true, changed: [] });
  expect(await cli(runtime, project, 'doctor')).toMatchObject({ ready: true });
  expect(await cli(runtime, project, 'uninstall')).toMatchObject({ removed: [], stateRetained: true });
  expect(await fs.readFile(path.join(project, '.codex/hooks.json'), 'utf8')).toBe(sharedHooks);
});

test('regenerating the OpenDock package removes obsolete staged files', async () => {
  await fs.writeFile('dist/opendock/payload/obsolete.txt', 'old package content');
  await exec(process.execPath, ['scripts/prepare-opendock.mjs']);
  await expect(fs.access('dist/opendock/payload/obsolete.txt')).rejects.toThrow();
});
