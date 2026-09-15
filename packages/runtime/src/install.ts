import fs from 'node:fs/promises';
import path from 'node:path';
import { Config, Role, SettingsInput, ensure } from './contracts.js';
import { exists, hash, lock, readJson, safePath, writeJson, atomic, exec } from './files.js';
import { VERSION } from './version.js';
import { configHash, hasChanges, hasPreferences, mergeSettings, settings } from './settings.js';
import { Store } from './store.js';

type Manifest = { schemaVersion: 1; version: string; files: Record<string, string> };
type Change = { file: string; contents: string };
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

async function commitFiles(project: string, changes: Change[]) {
  const written: { file: string; before: string | null }[] = [];
  try {
    for (const change of changes) {
      const file = await safePath(project, change.file);
      const before = await exists(file) ? await fs.readFile(file, 'utf8') : null;
      if (before === change.contents) continue;
      await atomic(file, change.contents); written.push({ file, before });
    }
  } catch (error) {
    const failures: string[] = [];
    for (const change of written.reverse()) {
      try { if (change.before === null) await fs.rm(change.file); else await atomic(change.file, change.before); }
      catch { failures.push(change.file); }
    }
    ensure(failures.length === 0, 'CONFIG_RECOVERY_REQUIRED', `A settings write failed and rollback could not restore: ${failures.join(', ')}. Inspect those files before continuing.`);
    throw error;
  }
}

// Update the generated top-level header only, preserving comments and the developer instruction body.
function updateProfile(contents: string, previous: Config['models'][Role], next: Config['models'][Role]) {
  const fields = new Map<string, string>();
  if (previous.model !== next.model) fields.set('model', next.model);
  if (previous.effort !== next.effort) fields.set('model_reasoning_effort', next.effort);
  const counts = new Map<string, number>();
  const lines = contents.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s*#/.test(line)) continue;
    if (/^\s*\[/.test(line) || line.includes('"""') || line.includes("'''")) break;
    const key = line.match(/^\s*(model|model_reasoning_effort)\s*=/)?.[1];
    if (!key || !fields.has(key)) continue;
    const match = line.match(/^(\s*(?:model|model_reasoning_effort)\s*=\s*)(?:"(?:\\.|[^"\\])*"|'[^']*')(\s*(?:#.*)?)$/);
    ensure(match, 'PROFILE_FORMAT_UNSUPPORTED', `Cannot safely update ${key}; reconcile the profile header first.`);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    lines[index] = `${match[1]}${JSON.stringify(fields.get(key))}${match[2]}`;
  }
  for (const key of fields.keys()) ensure(counts.get(key) === 1, 'PROFILE_FORMAT_UNSUPPORTED', `Expected one top-level ${key} in the profile header. Existing content was preserved.`);
  return lines.join(contents.includes('\r\n') ? '\r\n' : '\n');
}

export async function setup(project: string, pluginRoot: string, raw: unknown = {}) {
  const input = SettingsInput.parse(raw);
  const current = await settings(project);
  if (!current.configured && !hasPreferences(input)) return { ...current, installed: false, needsPreferences: true, next: 'Ask the user to choose a reasoning preset or role-specific model/effort, then call setup with that selection. Do not infer consent from an unanswered question.' };
  if (current.configured && hasChanges(input)) return { installed: true, needsPreferences: false, ...await configure(project, pluginRoot, input) };
  const dir = await safePath(project, '.orchestrail');
  const configPath = await safePath(project, '.orchestrail/config.json');
  await safePath(project, '.codex/agents');
  return lock(dir, async () => {
    const manifestPath = path.join(dir, 'install-manifest.json');
    const manifest: Manifest = await exists(manifestPath) ? await readJson(manifestPath) : { schemaVersion: 1, version: VERSION, files: {} };
    const configExists = await exists(configPath);
    ensure(current.configured || !configExists, 'STALE_CONFIG', 'Another setup saved preferences; read config before changing them.');
    const previous = configExists ? Config.parse(await readJson(configPath)) : Config.parse({});
    ensure(input.expectedConfigHash === undefined || input.expectedConfigHash === configHash(previous), 'STALE_CONFIG', 'Settings changed; read config again before updating.');
    const config = mergeSettings(previous, input);
    const changes: { file: string; contents: string }[] = [];
    const owned = new Set<string>();
    const conflicts: string[] = [];
    for (const role of Role.options) {
      const relative = `.codex/agents/orchestrail-${role}.toml`;
      const file = await safePath(project, relative);
      const source = await fs.readFile(path.join(pluginRoot, 'templates', 'agents', `orchestrail-${role}.toml`), 'utf8');
      const contents = source.replace(/^model = .*$/m, `model = ${JSON.stringify(config.models[role].model)}`).replace(/^model_reasoning_effort = .*$/m, `model_reasoning_effort = ${JSON.stringify(config.models[role].effort)}`);
      if (await exists(file)) {
        const current = hash(await fs.readFile(file));
        if (current === hash(contents)) continue;
        if (manifest.files[relative] === current) owned.add(relative);
        else if (current !== hash(source)) { conflicts.push(relative); continue; }
        // An exact bundled profile may belong to OpenDock; apply the requested preferences without claiming it.
      } else owned.add(relative);
      changes.push({ file: relative, contents });
    }
    ensure(conflicts.length === 0, 'INSTALL_CONFLICT', `Existing user-edited files were preserved: ${conflicts.join(', ')}. Reconcile them before setup.`);
    for (const change of changes) {
      if (owned.has(change.file)) manifest.files[change.file] = hash(change.contents);
    }
    manifest.version = VERSION;
    const profileChanges = changes.map(c => c.file);
    if (!(await exists(path.join(dir, '.gitignore')))) changes.push({ file: '.orchestrail/.gitignore', contents: '*\n' });
    changes.push({ file: '.orchestrail/install-manifest.json', contents: json(manifest) }, { file: '.orchestrail/config.json', contents: json(config) });
    await commitFiles(project, changes);
    return { installed: true, needsPreferences: false, changed: profileChanges, config, configHash: configHash(config), next: 'Review/trust the plugin hooks in Codex. Use explicit returned model/effort for native assignments; open a new task if the host requires it to reload named profiles. The main conversation model remains unchanged.' };
  });
}

export async function configure(project: string, pluginRoot: string, raw: unknown) {
  const input = SettingsInput.parse(raw);
  ensure(hasChanges(input), 'SETTINGS_REQUIRED', 'Specify a preset, role model/effort, or limit to change. Use config to inspect existing settings.');
  const dir = await safePath(project, '.orchestrail');
  const configPath = await safePath(project, '.orchestrail/config.json');
  ensure(await exists(configPath), 'SETUP_REQUIRED', 'Run setup with the user-selected preferences first.');
  return lock(dir, async () => {
    const previous = Config.parse(await readJson(configPath));
    ensure(input.expectedConfigHash === undefined || input.expectedConfigHash === configHash(previous), 'STALE_CONFIG', 'Settings changed; read config again before updating.');
    const config = mergeSettings(previous, input);
    const manifestPath = await safePath(project, '.orchestrail/install-manifest.json');
    const manifest: Manifest = await exists(manifestPath) ? await readJson(manifestPath) : { schemaVersion: 1, version: VERSION, files: {} };
    const changedRoles = Role.options.filter(role => JSON.stringify(previous.models[role]) !== JSON.stringify(config.models[role]));
    const changes: Change[] = [];
    for (const role of changedRoles) {
      const relative = `.codex/agents/orchestrail-${role}.toml`;
      const file = await safePath(project, relative);
      ensure(await exists(file), 'PROFILE_MISSING', `Missing ${relative}; run setup to restore profiles before changing settings.`);
      const before = await fs.readFile(file, 'utf8');
      const contents = updateProfile(before, previous.models[role], config.models[role]);
      // User-edited and OpenDock-owned files keep their original ownership.
      if (manifest.files[relative] === hash(before)) manifest.files[relative] = hash(contents);
      changes.push({ file: relative, contents });
    }
    const state = await new Store(project).load();
    const unchangedAssignments = Object.values(state.runs).flatMap(run => run.assignments.filter(a => ['reserved', 'running'].includes(a.status) && changedRoles.includes(a.role)).map(a => ({ id: a.id, role: a.role, model: a.model, effort: a.effort, status: a.status })));
    manifest.version = VERSION;
    changes.push({ file: '.orchestrail/install-manifest.json', contents: json(manifest) }, { file: '.orchestrail/config.json', contents: json(config) });
    await commitFiles(project, changes);
    return { configured: true, config, configHash: configHash(config), changedRoles, appliesTo: 'new assignments', unchangedAssignments, mainConversationChanged: false,
      next: 'Use explicit model/effort from the next assignment. Spawn a fresh agent when its model or effort changes; named profiles may require a new Codex task to reload.' };
  });
}
export async function uninstall(project: string) {
  const dir = await safePath(project, '.orchestrail');
  return lock(dir, async () => {
    const file = path.join(dir, 'install-manifest.json');
    const manifest: Manifest = await exists(file) ? await readJson(file) : { schemaVersion: 1, version: VERSION, files: {} };
    const removed: string[] = [], preserved: string[] = [];
    for (const [relative, checksum] of Object.entries(manifest.files)) {
      ensure(/^\.codex\/agents\/orchestrail-(scout|builder|reviewer|expert)\.toml$/.test(relative), 'INVALID_MANIFEST', 'Unexpected installed path.');
      const target = await safePath(project, relative);
      if (!(await exists(target))) { delete manifest.files[relative]; continue; }
      if (hash(await fs.readFile(target)) !== checksum) { preserved.push(relative); continue; }
      await fs.rm(target); delete manifest.files[relative]; removed.push(relative);
    }
    await writeJson(file, manifest);
    return { removed, preserved, stateRetained: true, note: 'Run history and user configuration are retained. Remove the plugin through Codex to disable its skills and hooks.' };
  });
}
export async function doctor(project: string, pluginRoot: string) {
  const configFile = await safePath(project, '.orchestrail/config.json');
  const configured = await exists(configFile);
  const config = configured ? Config.parse(await readJson(configFile)) : Config.parse({});
  let codexVersion: string | null = null;
  try { codexVersion = (await exec('codex', ['--version'], { timeout: 10000 })).stdout.trim(); } catch { /* report unavailable */ }
  const profiles = await Promise.all(Role.options.map(async role => {
    const file = await safePath(project, `.codex/agents/orchestrail-${role}.toml`);
    const contents = await exists(file) ? await fs.readFile(file, 'utf8') : '';
    return { role, installed: !!contents, modelMatchesConfig: contents.includes(`model = ${JSON.stringify(config.models[role].model)}`), effortMatchesConfig: contents.includes(`model_reasoning_effort = ${JSON.stringify(config.models[role].effort)}`) };
  }));
  return { version: VERSION, node: process.version, codexVersion, project, pluginRoot, configured, config, configHash: configured ? configHash(config) : null, profiles, ready: configured && profiles.every(p => p.installed && p.modelMatchesConfig && p.effortMatchesConfig), hooks: { trust: 'Check /hooks in Codex CLI or the host hook review UI. Installation does not grant trust.', coverage: 'Local tool guardrails; not a complete sandbox or billing limit.' }, modelAvailability: 'Not inferred from configuration; verify in your Codex model picker.', lockPresent: await exists(path.join(project, '.orchestrail', 'write.lock')) };
}
