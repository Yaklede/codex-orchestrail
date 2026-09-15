// Explicit, opt-in real-model smoke test. Never included in default CI.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrail-native-')));
await fs.mkdir(path.join(root, '.codex/agents'), { recursive: true });
await fs.writeFile(path.join(root, '.codex/config.toml'), '[agents]\nenabled = true\n');
await fs.writeFile(path.join(root, 'NUMBER.txt'), '7\n');
for (const [role, model] of [['scout', 'gpt-5.6-sol'], ['expert', 'gpt-6-astra']]) {
  await fs.writeFile(path.join(root, '.codex/agents', `orchestrail-${role}.toml`), `name = "orchestrail-${role}"\ndescription = "Read NUMBER.txt for a bounded compatibility test"\nmodel = "${model}"\nmodel_reasoning_effort = "low"\ndeveloper_instructions = "Read NUMBER.txt, return its number only, do not edit or delegate."\n`);
}
const recorder = path.join(root, 'record.mjs');
await fs.writeFile(recorder, `import fs from 'node:fs'; let s=''; for await(const c of process.stdin)s+=c; const e=JSON.parse(s); fs.appendFileSync(new URL('./events.jsonl',import.meta.url),JSON.stringify(e)+'\\n');console.log('{}');`);
const group = [{ hooks: [{ type: 'command', command: `node "${recorder}"`, timeout: 5 }] }];
const hooks = { hooks: Object.fromEntries(['SessionStart', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop'].map(e => [e, group])) };
await fs.writeFile(path.join(root, '.codex/hooks.json'), JSON.stringify(hooks));
execFileSync('git', ['init', '-q', '-b', 'main', root]);
console.log(`Temporary fixture: ${root}`);
// The sole hook is the reviewed recorder above, scoped to this fixture. End-user installation never bypasses trust.
const hookOverrides = Object.keys(hooks.hooks).flatMap(event => ['-c', `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(`node "${recorder}"`)},timeout=5}]}]`]);
const args = ['exec', '--ignore-user-config', '--enable', 'hooks', '--json', '--dangerously-bypass-hook-trust', '-s', 'workspace-write', '-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="low"', '-c', `projects.${JSON.stringify(root)}.trust_level="trusted"`, ...hookOverrides, '-C', root,
  'Run a bounded compatibility test in this directory. Delegate a scout to model gpt-5.6-sol with low effort and fresh/minimal context to read NUMBER.txt, while you independently read it. Wait for its result. Then delegate an expert to model gpt-6-astra with low effort and fresh/minimal context to independently read NUMBER.txt while you compare previous results, and wait. Pass model and reasoning explicitly; use named profiles if available. Do not edit, use external integrations, or delegate any other work. Report the returned numbers.'];
const child = spawn('codex', args, { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '', errors = '';
child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { errors += c; });
const timeout = setTimeout(() => child.kill('SIGTERM'), 240000);
const code = await new Promise(resolve => child.on('exit', resolve)); clearTimeout(timeout);
await fs.writeFile(path.join(root, 'output.jsonl'), output); await fs.writeFile(path.join(root, 'stderr.log'), errors);
let events = [];
try { events = (await fs.readFile(path.join(root, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); } catch {}
const starts = events.filter(e => e.hook_event_name === 'SubagentStart').map(e => ({ agentType: e.agent_type, model: e.model, agentId: e.agent_id }));
const passed = code === 0 && starts.some(e => e.model === 'gpt-5.6-sol') && starts.some(e => e.model === 'gpt-6-astra');
const report = { passed, exitCode: code, codexVersion: execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim(), root, observed: starts, eventCount: events.length };
await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
const thread = output.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(e => e.type === 'thread.started')?.thread_id;
if (thread) { try { execFileSync('codex', ['archive', thread], { stdio: 'ignore' }); } catch {} }
process.exitCode = passed ? 0 : 1;
