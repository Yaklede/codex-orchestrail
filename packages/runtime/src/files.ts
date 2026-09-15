import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensure, HarnessError, type Fingerprint } from './contracts.js';
export const exec = promisify(execFile);
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export const uid = (prefix: string) => `${prefix}-${randomUUID()}`;
export async function exists(file: string) { try { await fs.lstat(file); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export async function readJson(file: string) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export async function atomic(file: string, content: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
export const writeJson = (file: string, value: unknown) => atomic(file, JSON.stringify(value, null, 2) + '\n');
export async function safePath(root: string, relative: string) {
  ensure(!path.isAbsolute(relative), 'INVALID_PATH', 'Expected a project-relative path.');
  const resolved = path.resolve(root, relative);
  ensure(resolved.startsWith(root + path.sep), 'INVALID_PATH', 'Path leaves the project.');
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep)) {
    current = path.join(current, part);
    if (await exists(current)) ensure(!(await fs.lstat(current)).isSymbolicLink(), 'SYMLINK_PATH', `Managed path is a symlink: ${current}`);
  }
  return resolved;
}
export async function projectRoot(input: string) {
  const root = await fs.realpath(input);
  const { stdout } = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: root, timeout: 10000 });
  return fs.realpath(stdout.trim());
}
export async function fingerprint(project: string): Promise<Fingerprint> {
  const options = { cwd: project, timeout: 30000, maxBuffer: 32 * 1024 * 1024 };
  let head: string | null = null;
  try { head = (await exec('git', ['rev-parse', '--verify', 'HEAD'], options)).stdout.trim(); } catch { /* unborn repository */ }
  const { stdout } = await exec('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], options);
  const files = [...new Set(stdout.split('\0').filter(Boolean))].filter(f => !f.startsWith('.orchestrail/') && !f.startsWith('.opendock/')).sort();
  const digest = createHash('sha256').update(head ?? 'unborn');
  for (const file of files) {
    const full = path.join(project, file);
    digest.update(file + '\0');
    try {
      const stat = await fs.lstat(full);
      digest.update(String(stat.mode) + '\0');
      if (stat.isSymbolicLink()) digest.update(await fs.readlink(full));
      else if (stat.isFile()) digest.update(await fs.readFile(full));
      else if (stat.isDirectory()) {
        // Git submodules: include their own code state, not merely the gitlink.
        const child = await fingerprint(full);
        digest.update(child.hash);
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') digest.update('deleted'); else throw e; }
    digest.update('\0');
  }
  return { head, hash: digest.digest('hex'), fileCount: files.length };
}
export async function lock<T>(dir: string, action: () => Promise<T>): Promise<T> {
  const file = path.join(dir, 'write.lock');
  await fs.mkdir(dir, { recursive: true });
  let handle;
  for (let i = 0; i < 80; i++) {
    try { handle = await fs.open(file, 'wx', 0o600); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  if (!handle) throw new HarnessError('LOCKED', 'State is locked. If its process stopped, use recover-lock; never remove a live writer lock.');
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: now() })); await handle.sync(); return await action(); }
  finally { await handle.close(); await fs.rm(file, { force: true }); }
}
export async function recoverLock(dir: string) {
  const recovery = await fs.open(path.join(dir, 'recovery.lock'), 'wx', 0o600);
  try {
    const file = path.join(dir, 'write.lock');
    if (!(await exists(file))) return { recovered: false };
    const owner = await readJson(file);
    ensure(Number.isInteger(owner.pid) && owner.pid > 0, 'UNKNOWN_LOCK_OWNER', 'Cannot verify the lock owner.');
    let dead = false;
    try { process.kill(owner.pid, 0); } catch (e) { dead = (e as NodeJS.ErrnoException).code === 'ESRCH'; }
    ensure(dead, 'LIVE_LOCK', 'The writer process is still running or inaccessible.');
    await fs.rm(file);
    return { recovered: true };
  } finally { await recovery.close(); await fs.rm(path.join(dir, 'recovery.lock'), { force: true }); }
}
export function redact(value: string) {
  return value.replace(/\b(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/(Bearer\s+)[\w.+\/-]{12,}/gi, '$1[REDACTED]')
    .replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}
