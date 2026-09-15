import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HarnessError, HookInput } from './contracts.js';
import { execute } from './engine.js';
import { projectRoot, recoverLock } from './files.js';
import { handleHook } from './hooks.js';
import { configure, doctor, setup, uninstall } from './install.js';
import { settings } from './settings.js';
import { Store } from './store.js';
import { VERSION } from './version.js';

const HELP = `Orchestrail ${VERSION} — state helper for the Codex plugin

node <plugin>/scripts/orchestrail.mjs ACTION --project /path/to/repo [--session ID] [--input request.json]

Actions: setup, config, configure, doctor, uninstall, begin, finish, start, status, route, plan, assign, bind,
         result, evidence, verify, attempt, decision, packet, fingerprint,
         complete, revise, pause, cancel, resume, recover-lock, hook

Requests are JSON from --input or stdin. Hook input is the Codex event JSON.
Include runId to select a run, and expectedControlRevision for task-state optimistic writes.
Legacy expectedRevision checks all journal events. status is compact; {"detail":true} includes history.
Models execute in Codex; this helper never calls a model or changes login settings.
`;
async function stdin() { let value = ''; for await (const chunk of process.stdin) { value += chunk; if (value.length > 4 * 1024 * 1024) throw new Error('Input exceeds 4 MiB.'); } return value; }
async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { project: { type: 'string' }, session: { type: 'string' }, input: { type: 'string' }, help: { type: 'boolean' }, version: { type: 'boolean' } } });
  if (values.version || positionals[0] === 'version') { console.log(VERSION); return; }
  if (values.help || positionals.length === 0) { console.log(HELP); return; }
  const action = positionals[0]!;
  const payload = values.input ? await fs.readFile(values.input, 'utf8') : !process.stdin.isTTY ? await stdin() : '';
  const input = payload.trim() ? JSON.parse(payload) : {};
  const hook = action === 'hook' ? HookInput.parse(input) : undefined;
  const project = await projectRoot(values.project ?? hook?.cwd ?? process.cwd());
  const store = new Store(project);
  const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let result: unknown;
  if (action === 'setup') result = await setup(project, pluginRoot, input);
  else if (action === 'config') result = await settings(project);
  else if (action === 'configure') result = await configure(project, pluginRoot, input);
  else if (action === 'uninstall') result = await uninstall(project);
  else if (action === 'doctor') result = await doctor(project, pluginRoot);
  else if (action === 'recover-lock') result = await recoverLock(store.dir);
  else if (action === 'hook') result = await handleHook(store, input);
  else result = await execute(store, action, input, values.session ?? process.env.CODEX_THREAD_ID);
  console.log(JSON.stringify(result, null, action === 'hook' ? undefined : 2));
}
main().catch(error => {
  const isHook = process.argv.includes('hook');
  if (isHook) {
    // Unknown host errors must remain visible. Never return unsupported hook control fields.
    console.log(JSON.stringify({ systemMessage: `Orchestrail hook failed: ${error.message}. State enforcement may be unavailable; run doctor.` }));
  } else {
    console.error(JSON.stringify({ error: error instanceof HarnessError ? error.code : 'INVALID_INPUT', message: error.message }));
    process.exitCode = 1;
  }
});
