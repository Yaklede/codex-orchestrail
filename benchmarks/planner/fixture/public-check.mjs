import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBatches } from './src/planner.mjs';

test('respects every dependency', () => {
  assert.deepEqual(planBatches([{ id: 'c', dependsOn: ['a', 'b'] }, { id: 'a' }, { id: 'b', dependsOn: ['a'] }]), [['a'], ['b'], ['c']]);
});
test('preserves ready task input order', () => {
  assert.deepEqual(planBatches([{ id: 'z' }, { id: 'a' }, { id: 'm' }]), [['z', 'a'], ['m']]);
});
test('rejects cycles', () => {
  assert.throws(() => planBatches([{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]), RangeError);
});
test('handles empty input', () => assert.deepEqual(planBatches([]), []));
