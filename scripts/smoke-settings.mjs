// Opt-in behavioral check of the setup skill in isolated Codex tasks. Consumes Codex usage.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'orchestrail-preferences-')));
const plugin = path.join(root, '.codex/orchestrail');
await fs.cp('plugins/orchestrail', plugin, { recursive: true });
execFileSync('git', ['init', '-q', '-b', 'main', root]);
const runtime = path.join(plugin, 'scripts/orchestrail.mjs');
const skill = path.join(plugin, 'skills/orchestrail-setup/SKILL.md');
const configFile = path.join(root, '.orchestrail/config.json');
const present = async file => fs.access(file).then(() => true, () => false);
async function request(label, prompt) {
  const child = spawn('codex', ['exec','--ignore-user-config','--ephemeral','--json','-s','workspace-write','--add-dir',path.join(root,'.codex'),'-m','gpt-5.6-sol','-c','model_reasoning_effort="low"','-C',root,
    `이 임시 프로젝트에서 ${skill} 스킬을 사용하세요. 사용자 요청: ${prompt}\n이 테스트에서는 하위 에이전트, 외부 연동, 대화 전송 도구를 사용하지 마세요. 사용자 입력이 필요하면 최종 응답에 질문을 남기세요.`], { stdio: ['ignore','pipe','pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { errors += c; });
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
  const exitCode = await new Promise(resolve => child.on('exit', resolve)); clearTimeout(timer);
  await fs.writeFile(path.join(root, `${label}.jsonl`), output);
  await fs.writeFile(path.join(root, `${label}.stderr.log`), errors);
  const events = output.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {}; } });
  const final = events.filter(e => e.type === 'item.completed' && e.item?.type === 'agent_message').map(e => e.item.text).at(-1);
  return { exitCode, final };
}
console.log(`Temporary fixture: ${root}`);
const first = await request('first-setup', '이 프로젝트에 Orchestrail 설정해줘.');
const awaitedChoice = first.exitCode === 0 && !(await present(configFile)) && !(await present(path.join(root, '.codex/agents')));
console.log(JSON.stringify({ phase: 'first-setup', awaitedChoice, ...first }, null, 2));
if (!awaitedChoice) { process.exitCode = 1; }
else {
  execFileSync(process.execPath, [runtime,'setup','--project',root], { input: JSON.stringify({ preset: 'balanced' }) });
  const second = await request('change-preferences', 'Orchestrail은 기본 혼합 설정으로 이미 설정했어. Builder의 추론 수준을 medium으로, Expert의 모델을 gpt-5.6-sol과 추론 max로 바꿔줘. 나머지는 유지해.');
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  const doctor = JSON.parse(execFileSync(process.execPath, [runtime,'doctor','--project',root], { input:'{}', encoding:'utf8' }));
  const passed = second.exitCode === 0 && doctor.ready && config.models.builder.effort === 'medium' && config.models.expert.model === 'gpt-5.6-sol' && config.models.expert.effort === 'max' && config.models.scout.effort === 'medium' && config.models.reviewer.effort === 'high';
  const report = { passed, awaitedChoice, root, config: config.models, second };
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
  process.exitCode = passed ? 0 : 1;
}
