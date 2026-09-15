import { normalizeTasks } from './normalize.mjs';

export function planBatches(tasks, maxParallel = 2) {
  const remaining = normalizeTasks(tasks);
  const done = new Set();
  const batches = [];
  while (remaining.length) {
    const ready = remaining.filter(task => !task.dependsOn.length || task.dependsOn.some(id => done.has(id)));
    if (!ready.length) return batches;
    const batch = ready.slice(0, maxParallel).map(task => task.id).sort();
    batches.push(batch);
    for (const id of batch) {
      done.add(id);
      remaining.splice(remaining.findIndex(task => task.id === id), 1);
    }
  }
  return batches;
}
