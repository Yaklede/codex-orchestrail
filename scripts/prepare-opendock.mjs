import fs from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';

const root = path.resolve('dist/opendock');
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
await fs.cp('plugins/orchestrail', path.join(root, 'payload/orchestrail'), { recursive: true });
await fs.cp('plugins/orchestrail/templates/agents', path.join(root, 'payload/agents'), { recursive: true });
const skills = ['orchestrail', 'orchestrail-setup', 'orchestrail-status', 'orchestrail-resume'];
for (const skill of skills) {
  const original = await fs.readFile(`plugins/orchestrail/skills/${skill}/SKILL.md`, 'utf8');
  const frontmatter = original.match(/^---\n[\s\S]*?\n---/)[0];
  const folder = path.join(root, 'payload/skills', skill);
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(folder, 'SKILL.md'), `${frontmatter}\n\nRead and follow [the shared Orchestrail workflow](../../orchestrail/skills/${skill}/SKILL.md). Resolve its runtime and references relative to that shared file. This is the project-local OpenDock distribution. Native plugin hooks are not installed by this dock; use explicit helper calls and keep the returned session ID.\n`);
}
await fs.mkdir(path.join(root, 'payload'), { recursive: true });
await fs.writeFile(path.join(root, 'payload/AGENTS.md'), `## Orchestrail\n\nWhen the user asks to use Orchestrail, or continues an active Orchestrail run, read the matching skill in .codex/skills/orchestrail/SKILL.md (or orchestrail-setup, orchestrail-status, orchestrail-resume). Keep unrelated work unchanged. Use native Codex subagents for the bounded roles described by the workflow when independent work is useful. Keep state in .orchestrail/ and preserve the user's existing authorization.\n`);
await fs.copyFile('opendock/DOCK.md', path.join(root, 'DOCK.md'));
await fs.copyFile('LICENSE', path.join(root, 'LICENSE'));
const manifest = {
  opendock: 1, name: 'Orchestrail',
  summary: 'Sol execution and Astra decisions in one Codex conversation, with versioned plans and resumable local state.',
  readme: 'DOCK.md', tags: ['codex', 'orchestration', 'ai-agent', 'development'],
  requires: { runtimes: { node: '>=22.0.0', git: '>=2.0.0' } },
  files: [
    { from: 'payload/orchestrail', to: '.codex/orchestrail' },
    { from: 'payload/agents', to: '.codex/agents' },
    { from: 'payload/skills', to: '.codex/skills' },
    { from: 'payload/AGENTS.md', to: 'AGENTS.md' },
  ],
  doctor: [
    { id: 'runtime', check: 'test -f .codex/orchestrail/scripts/orchestrail.mjs' },
    { id: 'skill', check: 'test -f .codex/skills/orchestrail/SKILL.md' },
    { id: 'expert', check: 'test -f .codex/agents/orchestrail-expert.toml' },
  ],
};
await fs.writeFile(path.join(root, 'dock.yml'), stringify(manifest));
console.log(`Prepared ${root}/dock.yml. No login or registry submission was performed.`);
