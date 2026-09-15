import fs from 'node:fs/promises';
import path from 'node:path';
import { Config, Role, ensure } from './contracts.js';
import { exists, hash, lock, readJson, safePath, writeJson, atomic, exec } from './files.js';
import { VERSION } from './version.js';

type Manifest = { schemaVersion: 1; version: string; files: Record<string, string> };
export async function setup(project: string, pluginRoot: string) {
  const dir = await safePath(project, '.orchestrail');
  const configPath = await safePath(project, '.orchestrail/config.json');
  await safePath(project, '.codex/agents');
  return lock(dir, async () => {
    const manifestPath = path.join(dir, 'install-manifest.json');
    const manifest: Manifest = await exists(manifestPath) ? await readJson(manifestPath) : { schemaVersion: 1, version: VERSION, files: {} };
    const config = await exists(configPath) ? Config.parse(await readJson(configPath)) : Config.parse({});
    const changes: { file: string; contents: string }[] = [];
    const conflicts: string[] = [];
    for (const role of Role.options) {
      const relative = `.codex/agents/orchestrail-${role}.toml`;
      const file = await safePath(project, relative);
      const source = await fs.readFile(path.join(pluginRoot, 'templates', 'agents', `orchestrail-${role}.toml`), 'utf8');
      const contents = source.replace(/^model = .*$/m, `model = ${JSON.stringify(config.models[role].model)}`).replace(/^model_reasoning_effort = .*$/m, `model_reasoning_effort = ${JSON.stringify(config.models[role].effort)}`);
      if (await exists(file)) {
        const current = hash(await fs.readFile(file));
        if (current === hash(contents)) continue;
        if (manifest.files[relative] !== current) { conflicts.push(relative); continue; }
      }
      changes.push({ file: relative, contents });
    }
    ensure(conflicts.length === 0, 'INSTALL_CONFLICT', `Existing user-edited files were preserved: ${conflicts.join(', ')}. Reconcile them before setup.`);
    if (!(await exists(configPath))) await writeJson(configPath, config);
    const ignore = path.join(dir, '.gitignore');
    if (!(await exists(ignore))) await atomic(ignore, '*\n');
    for (const change of changes) {
      // Record ownership after the write; an unrecorded file is preserved on removal after a crash.
      const file = await safePath(project, change.file);
      await atomic(file, change.contents); manifest.files[change.file] = hash(change.contents);
      await writeJson(manifestPath, manifest);
    }
    if (!(await exists(manifestPath))) await writeJson(manifestPath, manifest);
    return { installed: true, changed: changes.map(c => c.file), preservedConfig: config, next: 'Review/trust the plugin hooks in Codex, then open a new task for custom agent discovery. Select Sol Medium for the main model and invoke Orchestrail.' };
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
  return { version: VERSION, node: process.version, codexVersion, project, pluginRoot, configured, profiles, ready: configured && profiles.every(p => p.installed && p.modelMatchesConfig && p.effortMatchesConfig), hooks: { trust: 'Check /hooks in Codex CLI or the host hook review UI. Installation does not grant trust.', coverage: 'Local tool guardrails; not a complete sandbox or billing limit.' }, modelAvailability: 'Not inferred from configuration; verify in your Codex model picker.', lockPresent: await exists(path.join(project, '.orchestrail', 'write.lock')) };
}
