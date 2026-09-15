# Dependency batch planner

Fix `src/planner.mjs` and `src/normalize.mjs` so `planBatches(tasks, maxParallel = 2)` follows this contract. Preserve the exported function names. Use no dependencies.

- `tasks` is an array of plain task objects with a nonempty string `id`. Whitespace-only IDs are invalid; valid IDs keep their original spelling (do not trim them). `dependsOn` is optional and defaults to `[]`; when present it must be an array of nonempty, non-whitespace strings. Repeated dependencies count once.
- Reject invalid shapes or a `maxParallel` that is not a positive safe integer with `TypeError`. Reject duplicate task IDs, unknown dependencies, self-dependencies and cycles with `RangeError`. Validation is required even for an empty graph (including `maxParallel`). Missing arguments are invalid. Error messages are not prescribed. Ignore extra task fields.
- Return an array of batches of task IDs. A task is eligible only when **all** dependencies completed in earlier batches. Select at most `maxParallel` ready tasks in original input order. Tasks selected in the current batch cannot unlock other tasks in that same batch. Do not defer an eligible task to prioritize a later input task. Return `[]` for an empty task array.
- Do not mutate the input array, task objects or dependency arrays. Frozen inputs must work.
- `normalizeTasks(tasks)` returns fresh `{ id, dependsOn }` objects with fresh, deduplicated dependency arrays, validates task shapes, duplicate IDs, unknown dependencies and self-dependencies, and does not need to detect cycles. Cycle detection belongs to `planBatches`.

Run `node --test public-check.mjs`. Add focused tests if useful, but do not alter this specification or the existing public tests. Only source edits and new test files are allowed. Finish with a brief description of the fix and verification.
