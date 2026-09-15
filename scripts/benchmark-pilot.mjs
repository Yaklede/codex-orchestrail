// Opt-in, real-model benchmark. Never invoked by CI or plugin hooks.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { jsonLines, normalizeUsage, parseExec, parseRollout, sumThreads, weeklyObservation, SUPPORTED_CODEX_VERSION } from './benchmark/metrics.mjs';

const { values } = parseArgs({ options: {
  run: { type: 'boolean', default: false }, mode: { type: 'string' }, out: { type: 'string' },
  'stop-at-weekly-percent': { type: 'string' }, 'weekly-resets-at': { type: 'string' },
  'timeout-seconds': { type: 'string', default: '360' },
} });
if (!values.run || !['sol', 'astra', 'orchestrail'].includes(values.mode) || !values.out) {
  throw new Error('Explicit opt-in required: --run --mode sol|astra|orchestrail --out NEW_DIRECTORY --stop-at-weekly-percent N --weekly-resets-at UNIX_SECONDS');
}
const stopAt = Number(values['stop-at-weekly-percent']);
const resetsAt = Number(values['weekly-resets-at']);
const timeoutMs = Number(values['timeout-seconds']) * 1000;
if (!(stopAt > 0 && stopAt <= 100 && Number.isSafeInteger(resetsAt) && resetsAt > 0 && timeoutMs >= 1000 && timeoutMs <= 600000)) throw new Error('Invalid budget window or timeout');
const version = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim();
if (version !== SUPPORTED_CODEX_VERSION) throw new Error(`Review the experimental usage adapter before using ${version}`);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.resolve(values.out);
await fs.mkdir(path.dirname(outputDir), { recursive: true });
await fs.mkdir(outputDir); // Never overwrite a previous measurement.
const project = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `orchestrail-bench-${values.mode}-`)));
await fs.cp(path.join(repo, 'benchmarks/planner/fixture'), project, { recursive: true });
const git = args => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', env: {
  ...process.env, GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
} }).trim();
git(['init', '-q', '-b', 'main']);
git(['add', '.']);
git(['-c', 'user.name=Orchestrail Benchmark', '-c', 'user.email=benchmark@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixed benchmark fixture']);
const baselineCommit = git(['rev-parse', 'HEAD']);
const baselineTree = git(['rev-parse', 'HEAD^{tree}']);
const spec = await fs.readFile(path.join(project, 'SPEC.md'), 'utf8');
const originalTests = await fs.readFile(path.join(project, 'public-check.mjs'), 'utf8');
const acceptance = await fs.readFile(path.join(repo, 'benchmarks/planner/acceptance.mjs'), 'utf8');
const evaluator = path.join(outputDir, 'acceptance.mjs');
await fs.writeFile(evaluator, acceptance);
const mode = values.mode;
const model = mode === 'astra' ? 'gpt-6-astra' : 'gpt-5.6-sol';
const effort = mode === 'orchestrail' ? 'medium' : 'high';
let runtime = null;
let plugin = null;
if (mode === 'orchestrail') {
  plugin = path.join(project, '.codex/orchestrail');
  await fs.cp(path.join(repo, 'plugins/orchestrail'), plugin, { recursive: true });
  runtime = path.join(plugin, 'scripts/orchestrail.mjs');
  execFileSync(process.execPath, [runtime, 'setup', '--project', project], { input: JSON.stringify({ preset: 'balanced' }) });
}

const hookFile = path.join(outputDir, 'hook.mjs');
const metadataFile = path.join(outputDir, 'hook-metadata.jsonl');
// All arms have the same metadata recorder. Only Orchestrail forwards the event
// to its existing hook. Record no user prompts, opaque tool payloads or credentials.
await fs.writeFile(hookFile, `import fs from 'node:fs';import {spawnSync} from 'node:child_process';
let input='';for await(const chunk of process.stdin)input+=chunk;const e=JSON.parse(input);
const record={event:e.hook_event_name,sessionId:e.session_id,turnId:e.turn_id,model:e.model,agentId:e.agent_id,transcriptPath:e.transcript_path,agentTranscriptPath:e.agent_transcript_path,toolName:e.tool_name};
fs.appendFileSync(${JSON.stringify(metadataFile)},JSON.stringify(record)+'\\n');
const runtime=${JSON.stringify(runtime)};
if(runtime){const r=spawnSync(process.execPath,[runtime,'hook'],{input,encoding:'utf8'});process.stdout.write(r.stdout||'{}');process.stderr.write(r.stderr||'');process.exitCode=r.status??1;}else process.stdout.write('{}');
`);
const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt', 'SessionEnd'];
const hookCommand = `node '${hookFile.replaceAll("'", "'\\''")}'`;
const overrides = events.flatMap(event => ['-c', `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(hookCommand)},timeout=8}]}]`]);
const commonPrompt = `Complete the dependency batch planner task in this checkout. Read SPEC.md and the existing code and public tests. Implement every requirement, run node --test public-check.mjs, and report briefly. Use only local project files and ordinary shell/file tools; do not use network, external integrations, other projects, or change user configuration. Do not edit SPEC.md or public-check.mjs. Do not commit or push. Stop once the task is complete.`;
const policy = mode === 'orchestrail'
  ? `Use the Orchestrail workflow. Read ${plugin}/skills/orchestrail/SKILL.md and its protocol. Setup already uses the balanced preset. The bundled helper is ${runtime}; project is ${project}. This benchmark explicitly requests one bounded native Builder delegation for the source fix while the root independently reviews SPEC.md and prepares acceptance verification. Use a fresh context and the exact reserved task_name, model and effort. Do not recursively delegate. Follow the normal route/plan/assign/result/verify/complete protocol. Use AC-1 for public tests and AC-2 for inspection of the complete specification. Escalate only if the normal policy requires it; do not force an expert call. Keep the root's changes to verification and harness state while the Builder owns the source. Include real evidence for both criteria. Finish the harness run before the final response.`
  : `Perform this task directly in this main agent without delegation or Orchestrail. Do not spawn subagents.`;
const prompt = `${commonPrompt}\n\n${policy}`;
await fs.writeFile(path.join(outputDir, 'prompt.txt'), prompt);
await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify({
  mode, model, effort, version, project, baselineCommit, baselineTree,
  fixtureHash: createHash('sha256').update(spec).update(originalTests).digest('hex'),
  evaluatorHash: createHash('sha256').update(acceptance).digest('hex'),
  harnessConfig: runtime ? JSON.parse(await fs.readFile(path.join(project, '.orchestrail/config.json'), 'utf8')) : null,
  stopAtWeeklyPercent: stopAt, weeklyResetsAt: resetsAt, timeoutMs,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
}, null, 2));
console.log(JSON.stringify({ event: 'benchmark.prepared', mode, project, outputDir, baselineCommit, model, effort }));

const records = async () => { try { return jsonLines(await fs.readFile(metadataFile, 'utf8')); } catch { return []; } };
const start = Date.now();
// This invocation trusts only the reviewed recorder and this repo's bundled
// hook. Model tool execution keeps the workspace-write sandbox in every arm.
const child = spawn('codex', ['exec', '--ignore-user-config', '--enable', 'hooks', '--json', '--dangerously-bypass-hook-trust',
  '-s', 'workspace-write', '-m', model, '-c', `model_reasoning_effort=${JSON.stringify(effort)}`, ...overrides, '-C', project, prompt,
], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let output = '', errors = '', stopReason = null, killing = null, polling = false;
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { errors += chunk; });
const stop = reason => {
  if (stopReason) return;
  stopReason = reason;
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  killing = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 3000);
};
const interrupt = () => stop('operator_interrupt');
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
const timer = setTimeout(() => stop('timeout'), timeoutMs);
const monitor = setInterval(async () => {
  if (polling || stopReason) return;
  polling = true;
  try {
    const hooks = await records();
    const locations = new Map();
    for (const e of hooks) {
      if (e.transcriptPath) locations.set(e.sessionId, e.transcriptPath);
      if (e.agentTranscriptPath) locations.set(e.agentId, e.agentTranscriptPath);
    }
    for (const [id, location] of locations) {
      // Ignore incomplete streaming records; final accounting fails closed.
      try {
        const parsed = parseRollout(await fs.readFile(location, 'utf8'), id, version);
        for (const point of parsed.weekly) {
          if (point.resetsAt !== resetsAt) stop('weekly_window_changed');
          else if (point.usedPercent >= stopAt) stop('weekly_observation_threshold');
        }
      } catch {}
    }
  } finally { polling = false; }
}, 2000);
const exitCode = await new Promise(resolve => {
  child.once('error', error => { errors += error.message; resolve(null); });
  child.once('close', resolve);
});
clearTimeout(timer); clearInterval(monitor); if (killing) clearTimeout(killing);
process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
await fs.writeFile(path.join(outputDir, 'native-output.jsonl'), output);
await fs.writeFile(path.join(outputDir, 'native-stderr.log'), errors);

const report = {
  mode, model, effort, version, baselineCommit, baselineTree, durationSeconds: (Date.now() - start) / 1000,
  exitCode, stopReason, project, quality: null, harness: null,
  measurement: { complete: false, source: 'codex-exec-json + experimental version-pinned per-thread rollout audit', threads: [], totals: null, weekly: null, errors: [] },
};
let rootId = null;
try {
  const parent = parseExec(output); rootId = parent.threadId;
  const hooks = await records();
  const parentHooks = hooks.filter(e => e.sessionId === rootId && !e.agentId);
  const observedModels = [...new Set(parentHooks.map(e => e.model).filter(Boolean))];
  if (observedModels.length !== 1 || observedModels[0] !== model) throw new Error('Parent observed model does not match request');
  const parentPath = parentHooks.find(e => e.transcriptPath)?.transcriptPath;
  const parentAudit = parseRollout(await fs.readFile(parentPath, 'utf8'), rootId, version);
  if (JSON.stringify(parentAudit.usage) !== JSON.stringify(parent.usage)) throw new Error('Parent CLI and rollout usage disagree');
  const threads = [{ threadId: rootId, kind: 'parent', model: observedModels[0], usage: parent.usage }];
  const weekly = [...parentAudit.weekly];
  const childStarts = hooks.filter(e => e.event === 'SubagentStart');
  const childIds = [...new Set(childStarts.map(e => e.agentId))];
  if (mode !== 'orchestrail' && childIds.length) throw new Error('Single-model baseline unexpectedly delegated');
  for (const id of childIds) {
    const startEvent = childStarts.find(e => e.agentId === id);
    const stopEvent = hooks.findLast(e => e.event === 'SubagentStop' && e.agentId === id);
    if (!stopEvent?.agentTranscriptPath) throw new Error(`Missing stopped child usage: ${id}`);
    const parsed = parseRollout(await fs.readFile(stopEvent.agentTranscriptPath, 'utf8'), id, version);
    threads.push({ threadId: id, kind: 'child', model: startEvent.model, usage: parsed.usage });
    weekly.push(...parsed.weekly);
  }
  report.measurement = { ...report.measurement, complete: true, threads, totals: sumThreads(threads), weekly: weeklyObservation(weekly), parentCommandCount: parent.commandCount };
  if (mode === 'orchestrail') {
    const state = JSON.parse(await fs.readFile(path.join(project, '.orchestrail/snapshot.json'), 'utf8'));
    const runs = Object.values(state.runs);
    report.harness = { runCount: runs.length, status: runs.at(-1)?.status, assignments: runs.at(-1)?.assignments.map(a => ({ role: a.role, model: a.actualModel, effort: a.effort, status: a.status, nativeAgentId: a.nativeAgentId })), evidenceCount: runs.at(-1)?.evidence.length };
    if (runs.length !== 1 || runs[0].status !== 'completed' || !runs[0].assignments.some(a => a.role === 'builder') || runs[0].assignments.some(a => !childIds.includes(a.nativeAgentId))) throw new Error('Harness protocol or child coverage is incomplete');
  }
} catch (error) {
  report.measurement.complete = false;
  report.measurement.totals = null;
  report.measurement.errors.push(error.message);
}
const specPreserved = spec === await fs.readFile(path.join(project, 'SPEC.md'), 'utf8');
const publicTestsPreserved = originalTests === await fs.readFile(path.join(project, 'public-check.mjs'), 'utf8');
try {
  const qualityOutput = execFileSync(process.execPath, ['--test', evaluator], { cwd: project, encoding: 'utf8', timeout: 15000, env: { ...process.env, ORCHESTRAIL_BENCHMARK_PROJECT: project } });
  await fs.writeFile(path.join(outputDir, 'acceptance-output.txt'), qualityOutput);
  report.quality = { passed: specPreserved && publicTestsPreserved && exitCode === 0 && !stopReason, specPreserved, publicTestsPreserved, exitCode: 0, tests: Number(qualityOutput.match(/# tests (\d+)/)?.[1]) };
} catch (error) {
  await fs.writeFile(path.join(outputDir, 'acceptance-output.txt'), String(error.stdout ?? '') + String(error.stderr ?? ''));
  report.quality = { passed: false, specPreserved, publicTestsPreserved, exitCode: error.status ?? null };
}
await fs.writeFile(path.join(outputDir, 'changes.patch'), git(['diff', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']));
await fs.cp(path.join(project, 'src'), path.join(outputDir, 'result-src'), { recursive: true });
await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
// Archive only successful, fully observed benchmark threads. Interrupted runs
// remain inspectable so an operator can verify all child work has stopped.
if (rootId && !stopReason && report.measurement.complete) {
  try { execFileSync('codex', ['archive', rootId], { stdio: 'ignore' }); } catch {}
}
process.exitCode = report.quality?.passed && report.measurement.complete ? 0 : 1;
