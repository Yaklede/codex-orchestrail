import { normalizeJobs } from './normalize.mjs';
export function createQueue(jobs) { return { jobs: normalizeJobs(jobs) }; }
export function claimJobs(state, now, limit = 1) { return { state, claimed: [] }; }
export function settleJob(state, event) { return state; }
