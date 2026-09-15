// Opt-in native integration test; consumes the user's Codex model allowance. Not run by CI.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrail-harness-')));
const plugin = path.join(root, '.codex/orchestrail');
await fs.cp('plugins/orchestrail', plugin, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', root]);
await fs.writeFile(path.join(root, 'NUMBER.txt'), '7\n');
const runtime = path.join(plugin, 'scripts/orchestrail.mjs');
const helper = (...args) => execFileSync(process.execPath, [runtime, ...args, '--project', root], { encoding: 'utf8', input: '{}' });
helper('setup');
const configFile = path.join(root, '.orchestrail/config.json');
const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
for (const role of Object.values(config.models)) role.effort = 'low';
await fs.writeFile(configFile, JSON.stringify(config)); helper('setup');
const recorder = path.join(root, '.orchestrail/hook.mjs');
await fs.writeFile(recorder, `import fs from 'node:fs';import{spawnSync}from'node:child_process';let s='';for await(const c of process.stdin)s+=c;const e=JSON.parse(s);fs.appendFileSync(new URL('./native-events.jsonl',import.meta.url),JSON.stringify(e)+'\\n');const r=spawnSync(process.execPath,[${JSON.stringify(runtime)},'hook'],{input:s,encoding:'utf8'});process.stdout.write(r.stdout||'{}');process.stderr.write(r.stderr||'');process.exitCode=r.status??1;`);
const events = ['SessionStart','UserPromptSubmit','PreToolUse','PostToolUse','SubagentStart','SubagentStop','Stop','Interrupt','SessionEnd'];
const overrides = events.flatMap(event => ['-c', `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(`node "${recorder}"`)},timeout=8}]}]`]);
const prompt = `Run the bounded Orchestrail integration fixture in this directory. You are explicitly asked to delegate the two native subagents below, doing independent useful work while each runs. Read ${plugin}/references/protocol.md first. Use ${runtime} for all helper calls with --project ${root}, and the native session ID provided by the hook. Use JSON request files under .orchestrail/ or pipe structured JSON into the helper. Do not edit NUMBER.txt, access external integrations, change account configuration, or delegate other work.
1. start: goal "Verify both native models and current-code completion"; criteria [{id:"AC-1",description:"NUMBER.txt is exactly 7"}]. route kind feature, reason "Known read-only fixture". Save plan with summary "Read and verify fixture", one step id read, objective "Verify NUMBER.txt", criteria ["AC-1"].
2. assign role scout, objective "Read NUMBER.txt and return Result JSON". Use EXACT returned taskName as task_name, model and effort explicitly, fresh context fork_turns none, and marker [orchestrail:ASSIGNMENT_ID] in the message. Give child the assignment id and planVersion and Result contract. While it runs, independently read NUMBER.txt and prepare the verification command. Wait for its final JSON; inspect status and record result only if the hook has not already ingested it.
3. route kind architecture, reason "Explicit compatibility test of the expert role". assign expert objective "Confirm the plan can be kept". Spawn with exact taskName/model/effort and fresh context, include its assignment marker, read-only instructions, and require Decision JSON {assignmentId:ACTUAL,outcome:"KEEP_PLAN",summary:"The fixture plan is sufficient"}. While it runs, compare the scout result against the criterion. Wait, then ingest its JSON using decision.
4. verify AC-1 with argv ["node","-e","if(require('fs').readFileSync('NUMBER.txt','utf8').trim()!=='7')process.exit(1)"], description "Check fixture number". complete and report the returned runId. Stop after this fixture. No recursive delegation or broader testing.`;
console.log(`Temporary fixture: ${root}`);
// Only this fixture's reviewed recorder and bundled hook are trusted by this isolated invocation.
const child = spawn('codex', ['exec','--ignore-user-config','--enable','hooks','--json','--dangerously-bypass-hook-trust','-s','workspace-write','-m','gpt-5.6-sol','-c','model_reasoning_effort="low"',...overrides,'-C',root,prompt], { stdio: ['ignore','pipe','pipe'] });
let output = '', errors = '';
child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { errors += c; });
const timer = setTimeout(() => child.kill('SIGTERM'), 300000);
const exitCode = await new Promise(resolve => child.on('exit', resolve)); clearTimeout(timer);
await fs.writeFile(path.join(root, '.orchestrail/native-output.jsonl'), output);
await fs.writeFile(path.join(root, '.orchestrail/native-stderr.log'), errors);
let snapshot = { runs: {} };
try { snapshot = JSON.parse(await fs.readFile(path.join(root, '.orchestrail/snapshot.json'), 'utf8')); } catch {}
const runs = Object.values(snapshot.runs);
const run = runs.at(-1);
const models = run?.assignments.map(a => ({ role: a.role, requested: a.model, actual: a.actualModel, nativeTaskName: a.nativeTaskName, status: a.status })) ?? [];
const passed = exitCode === 0 && runs.length === 1 && run.status === 'completed' && models.length === 2 && models.some(m => m.actual === 'gpt-5.6-sol') && models.some(m => m.actual === 'gpt-6-astra') && models.every(m => m.status === 'completed');
const report = { passed, exitCode, codexVersion: execFileSync('codex',['--version'],{encoding:'utf8'}).trim(), root, runStatus: run?.status, models, verificationCount: run?.evidence.length };
await fs.writeFile(path.join(root, '.orchestrail/native-report.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
const thread = output.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {}; } }).find(e => e.type === 'thread.started')?.thread_id;
if (thread) { try { execFileSync('codex',['archive',thread],{stdio:'ignore'}); } catch {} }
process.exitCode = passed ? 0 : 1;
