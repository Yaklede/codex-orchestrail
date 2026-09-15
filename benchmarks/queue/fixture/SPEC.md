# Immutable job queue

Implement `src/normalize.mjs`, `src/queue.mjs`, and `src/report.mjs` using only standard JavaScript. Preserve their exports. This is a deterministic in-memory library; no timers, network, filesystem access, or dependencies belong in the implementation.

## Input and ownership

`normalizeJobs(jobs)` accepts an array of plain objects (Object.prototype or null prototype). Each needs a nonempty, non-whitespace string `id`, preserved exactly. Ignore extra fields. IDs must be unique. Optional own properties are `priority` (safe integer, default 0), `availableAt` (nonnegative safe integer, default 0), and `maxAttempts` (positive safe integer, default 3). An optional property present with undefined is invalid. Reject malformed input with TypeError and duplicate IDs with RangeError. Do not mutate frozen inputs. Return fresh canonical jobs with exactly id, priority, availableAt, maxAttempts, attempts:0, status:'queued', lastError:null.

`createQueue(jobs)` returns `{jobs: normalizeJobs(jobs)}`. The other functions receive a state previously produced by this API; validation of arbitrary foreign/corrupt states is outside scope. Every returned state and job object must be independent of the input, including unchanged jobs. Caller mutation of a returned state cannot change an older state. Preserve job array order across transitions.

## Claiming

`claimJobs(state, now, limit = 1)` returns `{state, claimed}`. Both now and limit must be safe integers; now >= 0 and limit > 0. Validate these even for empty queues. A job is ready only if queued and availableAt <= now. Select by descending priority, breaking ties by original array position. Claim at most limit. Claimed jobs become running and attempts increases once. `claimed` contains IDs in selection order. Running or terminal jobs are never selected. No ready jobs still returns an independent state and an empty claimed array.

## Settling

`settleJob(state, event)` returns a new state. event is a plain object with nonempty, non-whitespace string id and outcome in 'succeeded', 'failed', 'cancelled'; extra fields are ignored. Unknown IDs raise RangeError; malformed event fields raise TypeError.

- succeeded requires a running job, changes status to succeeded, and clears lastError to null.
- cancelled requires a queued or running job, changes status to cancelled, preserves attempts and lastError.
- failed requires a running job and requires event.error (nonempty, non-whitespace string) and event.now (nonnegative safe integer). Optional own retryDelay defaults to 0 and must be a nonnegative safe integer, including rejecting explicit undefined. Validate failed-event fields even when the final attempt is exhausted. Set lastError to the supplied string. If attempts < maxAttempts, return the job to queued with availableAt = now + retryDelay; reject an unsafe sum with RangeError. Otherwise mark failed and retain the prior availableAt; no retry is scheduled.

Every invalid status transition raises RangeError. An error leaves the original state unchanged. attempts increases only on claim, not on settle; a job at maxAttempts becomes terminal when its running attempt fails.

## Reporting

`summarizeQueue(state, now)` validates now as a nonnegative safe integer and returns exactly `{counts, totalAttempts, readyIds}`. counts always has queued, running, succeeded, failed, cancelled, including zero values. totalAttempts sums all attempts. readyIds lists all ready IDs in the same priority/order rule as claim, without changing state. Terminal and delayed jobs are excluded. An empty queue reports all zero counts, 0 totalAttempts, and [].

Run `node --test public-check.mjs`. Add focused tests if useful, but do not edit this specification or the public tests. Only source edits and new test files are allowed. Report the implementation and verification briefly.
