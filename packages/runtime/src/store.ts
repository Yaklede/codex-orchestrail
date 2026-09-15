import fs from 'node:fs/promises';
import path from 'node:path';
import { Config, StateShape, ensure, type State } from './contracts.js';
import { exists, hash, lock, now, readJson, safePath, uid, writeJson } from './files.js';

// Diagnostics must not invalidate a pending plan/assignment write. Everything
// except these explicitly observational fields remains part of concurrency control.
function controlState(state: State) {
  const { revision, controlRevision, receipts, ...rest } = state;
  return JSON.stringify({ ...rest,
    sessions: Object.fromEntries(Object.entries(state.sessions).map(([key, session]) => {
      const { observedModel, lastHook, hookAt, ...owned } = session;
      return [key, owned];
    })),
    runs: Object.fromEntries(Object.entries(state.runs).map(([key, run]) => {
      const { observations, ...owned } = run;
      return [key, owned];
    })),
  });
}

export const controlRevision = (state: State) => state.controlRevision ?? state.revision;

export class Store {
  constructor(readonly project: string) {}
  get dir() { return path.join(this.project, '.orchestrail'); }
  async config() { return Config.parse(await readJson(await safePath(this.project, '.orchestrail/config.json'))); }
  async load(): Promise<State> {
    await safePath(this.project, '.orchestrail');
    const file = path.join(this.dir, 'events.jsonl');
    if (!(await exists(file))) return { schemaVersion: 1, revision: 0, project: this.project, sessions: {}, runs: {}, receipts: [] };
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split('\n');
    // A final partial record has never committed and is ignored until the next write repairs it.
    lines.pop();
    let result: State | undefined;
    let revision = 0;
    for (const line of lines) {
      if (!line) continue;
      const event = JSON.parse(line);
      ensure(event.revision === revision + 1 && event.checksum === hash(JSON.stringify(event.state)), 'CORRUPT_LOG', 'Event log checksum or revision mismatch.');
      StateShape.parse(event.state);
      result = event.state as State;
      ensure(result.revision === event.revision, 'CORRUPT_LOG', 'State revision does not match event.');
      revision = event.revision;
    }
    const state = result ?? { schemaVersion: 1 as const, revision: 0, project: this.project, sessions: {}, runs: {}, receipts: [] };
    ensure(state.project === this.project, 'WORKSPACE_MOVED', 'State belongs to another checkout. Start a new run in this checkout.');
    return state;
  }
  async mutate<T>(kind: string, update: (state: State) => T | Promise<T>, expectedRevision?: number, expectedControlRevision?: number): Promise<T> {
    await safePath(this.project, '.orchestrail');
    return lock(this.dir, async () => {
      const state = await this.load();
      ensure(expectedRevision === undefined || expectedRevision === state.revision, 'STALE_REVISION', 'State changed; reload status before updating.');
      ensure(expectedControlRevision === undefined || expectedControlRevision === controlRevision(state), 'STALE_CONTROL_REVISION', 'Task state changed; reload status before updating.');
      const before = JSON.stringify(state);
      const beforeControl = controlState(state);
      const previousControlRevision = controlRevision(state);
      const result = await update(state);
      if (before === JSON.stringify(state)) return result;
      state.controlRevision = previousControlRevision + Number(beforeControl !== controlState(state));
      state.revision++;
      const event = { id: uid('event'), at: now(), kind, revision: state.revision, checksum: hash(JSON.stringify(state)), state };
      const file = path.join(this.dir, 'events.jsonl');
      if (await exists(file)) {
        const previous = await fs.readFile(file);
        const committed = previous.lastIndexOf(10) + 1;
        if (committed !== previous.length) await fs.truncate(file, committed);
      }
      const handle = await fs.open(file, 'a', 0o600);
      try { await handle.writeFile(JSON.stringify(event) + '\n'); await handle.sync(); } finally { await handle.close(); }
      await writeJson(path.join(this.dir, 'snapshot.json'), state);
      return result;
    });
  }
}
