import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, claimJobs, settleJob } from './src/queue.mjs';
import { summarizeQueue } from './src/report.mjs';
test('priority and delayed jobs', () => {
  const q = createQueue([{ id:'a' },{ id:'b',priority:3 },{ id:'c',priority:9,availableAt:10 }]);
  assert.deepEqual(claimJobs(q,0,2).claimed,['b','a']);
});
test('retry then success', () => {
  const q = claimJobs(createQueue([{id:'a'}]),0).state;
  const retry = settleJob(q,{id:'a',outcome:'failed',error:'temporary',now:2,retryDelay:5});
  assert.deepEqual(claimJobs(retry,6).claimed,[]);
  const done = settleJob(claimJobs(retry,7).state,{id:'a',outcome:'succeeded'});
  assert.equal(done.jobs[0].status,'succeeded'); assert.equal(done.jobs[0].attempts,2);
});
test('ownership', () => {
  const before = createQueue([{id:'a'}]); const after = claimJobs(before,0).state;
  assert.equal(before.jobs[0].status,'queued'); assert.equal(after.jobs[0].status,'running');
});
test('empty report', () => assert.deepEqual(summarizeQueue(createQueue([]),0),{counts:{queued:0,running:0,succeeded:0,failed:0,cancelled:0},totalAttempts:0,readyIds:[]}));
