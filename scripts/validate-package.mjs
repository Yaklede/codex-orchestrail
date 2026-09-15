import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parse } from 'yaml';

const root = path.resolve('plugins/orchestrail');
const manifest = JSON.parse(await fs.readFile(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
const catalog = JSON.parse(await fs.readFile('.agents/plugins/marketplace.json', 'utf8'));
assert.equal(manifest.name, 'orchestrail');
assert.equal(catalog.name, 'orchestrail');
assert.equal(catalog.plugins[0].source.path, './plugins/orchestrail');
assert.equal(manifest.version, JSON.parse(await fs.readFile('package.json', 'utf8')).version);
for (const name of ['orchestrail', 'orchestrail-setup', 'orchestrail-status', 'orchestrail-resume']) {
  const file = path.join(root, 'skills', name, 'SKILL.md');
  const content = await fs.readFile(file, 'utf8');
  const front = content.match(/^---\n([\s\S]*?)\n---/);
  assert(front, `Missing frontmatter: ${file}`);
  const metadata = parse(front[1]); assert.equal(metadata.name, name); assert(metadata.description);
  for (const match of content.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) await fs.access(path.resolve(path.dirname(file), match[1]));
  assert(!content.includes('[TODO:'));
}
const hooks = JSON.parse(await fs.readFile(path.join(root, 'hooks/hooks.json'), 'utf8'));
for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) {
  assert.equal(hook.command, 'node "${PLUGIN_ROOT}/scripts/orchestrail.mjs" hook');
  assert(hook.timeout <= 10);
}
await fs.access(path.join(root, 'scripts/orchestrail.mjs'));
for (const role of ['scout', 'builder', 'reviewer', 'expert']) await fs.access(path.join(root, 'templates/agents', `orchestrail-${role}.toml`));
console.log('Plugin package, marketplace, skill references and hook entry points validated.');
