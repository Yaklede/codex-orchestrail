export function normalizeTasks(tasks) {
  return tasks.map(task => ({ id: task.id, dependsOn: task.dependsOn ?? [] }));
}
