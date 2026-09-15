// The runner executes this outside the model's project after the turn finishes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const project = process.env.ORCHESTRAIL_BENCHMARK_PROJECT;
if (!project) throw new Error('ORCHESTRAIL_BENCHMARK_PROJECT is required');
const { planBatches } = await import(pathToFileURL(path.join(project, 'src/planner.mjs')));
const { normalizeTasks } = await import(pathToFileURL(path.join(project, 'src/normalize.mjs')));

test('all dependencies and earlier batches', () => assert.deepEqual(planBatches([
  { id: 'd', dependsOn: ['a', 'b'] }, { id: 'a' }, { id: 'b', dependsOn: ['c'] }, { id: 'c' },
]), [['a', 'c'], ['b'], ['d']]));
test('ready work preserves input order at each frontier', () => assert.deepEqual(planBatches([
  { id: 'z', dependsOn: ['a'] }, { id: 'a' }, { id: 'b' }, { id: 'c' },
]), [['a', 'b'], ['z', 'c']]));
test('current batch cannot unlock tasks', () => assert.deepEqual(planBatches([
  { id: 'a' }, { id: 'b', dependsOn: ['a'] }, { id: 'c', dependsOn: ['b'] },
], 9), [['a'], ['b'], ['c']]));
test('concurrency one', () => assert.deepEqual(planBatches([{ id: 'z' }, { id: 'a' }, { id: 'm' }], 1), [['z'], ['a'], ['m']]));
test('wide concurrency', () => assert.deepEqual(planBatches([{ id: 'z' }, { id: 'a' }], 20), [['z', 'a']]));
test('empty input', () => assert.deepEqual(planBatches([]), []));
test('duplicate dependencies collapse', () => assert.deepEqual(planBatches([{ id: 'b', dependsOn: ['a', 'a'] }, { id: 'a' }]), [['a'], ['b']]));
test('normalizer returns independent deduplicated objects', () => {
  const tasks = [{ id: 'a', extra: true }, { id: 'b', dependsOn: ['a', 'a'] }];
  const result = normalizeTasks(tasks);
  assert.deepEqual(result, [{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }]);
  assert.notEqual(result, tasks); assert.notEqual(result[1], tasks[1]); assert.notEqual(result[1].dependsOn, tasks[1].dependsOn);
  result[1].dependsOn.push('x'); assert.deepEqual(tasks[1].dependsOn, ['a', 'a']);
});
test('frozen input and dependencies', () => {
  const tasks = Object.freeze([Object.freeze({ id: 'b', dependsOn: Object.freeze(['a', 'a']) }), Object.freeze({ id: 'a' })]);
  assert.deepEqual(planBatches(tasks), [['a'], ['b']]);
});
test('valid identifiers preserve whitespace and special spelling', () => assert.deepEqual(planBatches([
  { id: '__proto__' }, { id: ' a ' }, { id: 'constructor', dependsOn: ['__proto__', ' a '] },
]), [['__proto__', ' a '], ['constructor']]));
for (const [name, input] of [
  ['missing input', undefined], ['null input', null], ['object input', {}], ['string input', 'abc'],
  ['null task', [null]], ['array task', [[]]], ['missing id', [{}]], ['numeric id', [{ id: 2 }]],
  ['empty id', [{ id: '' }]], ['whitespace id', [{ id: ' \t ' }]],
  ['null dependencies', [{ id: 'a', dependsOn: null }]], ['string dependencies', [{ id: 'a', dependsOn: 'b' }]],
  ['explicit undefined dependencies', [{ id: 'a', dependsOn: undefined }]],
  ['invalid dependency', [{ id: 'a', dependsOn: [2] }]], ['blank dependency', [{ id: 'a', dependsOn: [' '] }]],
]) test(name, () => { assert.throws(() => planBatches(input), TypeError); assert.throws(() => normalizeTasks(input), TypeError); });
for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
  test(`invalid concurrency ${String(value)}`, () => assert.throws(() => planBatches([], value), TypeError));
}
for (const [name, input] of [
  ['duplicate IDs', [{ id: 'a' }, { id: 'a' }]],
  ['unknown dependency', [{ id: 'a', dependsOn: ['missing'] }]],
  ['self dependency', [{ id: 'a', dependsOn: ['a'] }]],
]) test(name, () => { assert.throws(() => planBatches(input), RangeError); assert.throws(() => normalizeTasks(input), RangeError); });
test('cycle including independent completed work', () => assert.throws(() => planBatches([
  { id: 'ok' }, { id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] },
]), RangeError));
test('longer cycle', () => assert.throws(() => planBatches([
  { id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['c'] }, { id: 'c', dependsOn: ['a'] },
]), RangeError));
test('long chain in reverse input order', () => {
  const tasks = Array.from({ length: 100 }, (_, i) => ({ id: `t${i}`, dependsOn: i ? [`t${i - 1}`] : [] })).reverse();
  assert.deepEqual(planBatches(tasks, 10), Array.from({ length: 100 }, (_, i) => [`t${i}`]));
});
