# Token-efficiency benchmarks

This opt-in tool supports direct and explicitly delegated comparisons. The original pilot compared Sol high, Astra high and a Sol medium root with a Sol high Builder; that is historical evidence, not the current default policy. It uses the user's existing Codex authentication and consumes Codex allowance. It is excluded from CI. No API key or separate model runtime is used.

0.3.0 results: [direct execution and selective delegation](benchmark-results-2026-09-15-v03.md).

Completed initial pilot: [2026-09-15 results](benchmark-results-2026-09-15.md), with [aggregate data](../benchmarks/results/2026-09-15-pilot.json).

This measures three configured workflows, including their reasoning choices. It does not isolate the effect of orchestration from reasoning effort. The pilot explicitly exercises one Builder delegation while the parent reviews the specification; Orchestrail can choose direct root execution for small tasks in normal use. An expert is not forced into a routine task.

## Version 0.3 comparisons

| Mode | Main | Plugin workflow | Purpose |
| --- | --- | --- | --- |
| `astra` | Astra high | None, direct | Matched baseline |
| `astra-direct` | Astra high | Default direct path, no tracked state or child | Measure skill/idle-hook overhead on the planner |
| `astra-delegate` | Astra high | Main judgment, one Sol high Builder, begin/finish | Measure explicit selective delegation on the larger queue |
| `sol` | Sol high | None | Optional model comparison |
| `orchestrail` | Sol medium | Explicit Builder, granular protocol | Diagnostic legacy-style arm; use the historical commit to reproduce old code exactly |

`--workload planner` is the default; `--workload queue` selects a larger immutable queue library with normalization, priority scheduling, retries, terminal transitions, reports and ownership requirements. The two arms of each comparison must use the same workload, fixture/evaluator hashes and model/effort. The queue's 61-test evaluator is fixed before either model run; it is a bounded contract check, not exhaustive assurance.

The direct arm explicitly forbids delegation to isolate the overhead floor. The delegated arm explicitly requests one Builder; it measures that workflow, not the accuracy of automatic delegation selection. Neither establishes a general savings claim. The main skill is read from the isolated plugin path, not through a desktop picker; this includes the read cost but does not validate every host's discovery overhead. Metadata records the plugin runtime/skill hash as well as source HEAD because development runs may use uncommitted changes.

Use separate opt-in invocations, checking current allowance between them:

```bash
node scripts/benchmark-pilot.mjs --run --mode astra-direct --workload planner \
  --out dist/benchmarks/direct-check/plugin \
  --stop-at-weekly-percent YOUR_THRESHOLD --weekly-resets-at CURRENT_RESET_TIMESTAMP
node scripts/benchmark-pilot.mjs --run --mode astra-delegate --workload queue \
  --out dist/benchmarks/queue-check/delegated \
  --stop-at-weekly-percent YOUR_THRESHOLD --weekly-resets-at CURRENT_RESET_TIMESTAMP
```

Compare each with a separate `astra` run of the same workload. Inspect failures and final code before drawing conclusions. Do not start additional runs at the selected usage threshold.

## Fixture and evaluation

`benchmarks/planner/fixture` contains a deliberately broken, dependency-free JavaScript batch planner. Each arm receives an isolated temporary Git checkout with the same initial commit, specification and public tests. The fixture needs input validation, deterministic dependency scheduling, cycle detection and immutable inputs.

The model runs four public tests. After its turn finishes, the runner evaluates the result against 39 separately stored tests covering the specification, including invalid inputs and scheduling edge cases. The model does not receive the evaluator's path. The runner checks that the original specification and public tests were preserved and saves the code diff. Passing these tests is a bounded correctness criterion, not proof that all possible behavior or code quality is equivalent. Review the resulting diffs too.

Baseline observation: the initial code passes 1/4 public tests and 11/39 acceptance tests. The broken fixture is not part of the repository's ordinary test suite. The first pilot used 38 predeclared tests; source review found an uncovered explicit-undefined dependency case already required by SPEC.md. The 39th test was added afterward and applied equally to all completed outputs without another model call. Preserve this distinction when reporting that pilot.

## Run one arm at a time

First read the current account's weekly limit, record its reset timestamp, and choose an observation threshold. For example, with 40% used and a 5 percentage-point budget, the threshold is 45. **The threshold is not a forecast of required usage.** Do not copy an old reset timestamp into a new benchmark.

```bash
pnpm check
node scripts/benchmark-pilot.mjs --run --mode sol \
  --out dist/benchmarks/my-pilot/sol \
  --stop-at-weekly-percent 45 --weekly-resets-at CURRENT_RESET_TIMESTAMP
```

Inspect that result and current account usage before separately running `--mode astra` and `--mode orchestrail`, each with a new output directory. No command automatically launches all arms or a 27-run study. `--timeout-seconds` defaults to 360 and accepts up to 600. Do not run other account tasks during a calibrated allowance comparison.

The runner's version-pinned transcript monitor stops its process group on the observed weekly threshold, a changed reset window or timeout. Quota reporting can lag, other account work contributes, and an in-flight model request can consume allowance before the next observation. **This is an approximate stop condition, not a hard spending cap.** Missing telemetry must be inspected manually between arms. Interrupting the runner sends a termination signal to its process group; interrupted native tasks remain unarchived for inspection.

Every arm uses `workspace-write`, ignores user config, and supplies the same metadata hook. The benchmark invocation trusts only that reviewed recorder and, for the harness arm, the repo's bundled hook. It does not install hooks globally or change user settings. Temporary repositories and logs are retained for inspection. Successful fully measured native tasks are archived after collection.

## Usage accounting

- Parent usage comes from the documented `codex exec --json` `turn.completed.usage` event.
- Child usage currently uses a **benchmark-only experimental adapter pinned to Codex CLI 0.154.0**. It reads only transcript paths supplied by this run's hooks and checks each transcript's session ID. It does not scan arbitrary user conversations.
- The parent transcript's last cumulative usage must match the CLI event. For each observed child, use its last cumulative count exactly once; repeated token events are not additional consumption. Missing child stops, wrong versions, mismatched IDs or decreasing counters invalidate the total.
- Sum distinct parent and child thread totals. `input_tokens + output_tokens` is the raw total. Cached input and reasoning output are subsets; do not add them again. Report uncached input, cached input and reasoning output separately.
- Child coverage is checked against harness assignments. A failed or incomplete run remains in the results, with a null complete total if coverage cannot be established. Last available per-thread counts are separately retained as partial observations and must not be labeled final usage. Do not drop expensive failures from later comparisons.
- This local audit does not provide service billing, exact subscription charging, or a stable token meter in the installed plugin. The plugin's normal `status` continues to return null token and cost fields.

Official documentation provides [CLI JSON usage](https://learn.chatgpt.com/docs/non-interactive-mode), but explicitly says the [hook transcript format is not stable](https://learn.chatgpt.com/docs/hooks#common-input-fields). The version-pinned audit must be reviewed on a host upgrade. A future stable integration should use host-provided per-thread usage events where accessible rather than turn the transcript adapter into a core plugin dependency.

## Interpretation

Compare quality first, then total tokens, cached/uncached input, output/reasoning, wall time and number of assignments. A switch to another model is not itself evidence of fewer tokens. Model pricing and subscription usage are different metrics.

The initial order is Sol, Astra, Orchestrail, once each. That is a **pilot**, with no estimate of run-to-run variance and no randomized order. Cache behavior is observed rather than forced. It cannot establish a general savings percentage, the best reasoning level, or the value of expert escalation on difficult work.

Record account-level usage before preparation, immediately before and after each arm, and after the final result settles. A displayed 0-point change means no visible change, not zero consumption. Do not derive a token-to-weekly-percentage conversion from an unchanged coarse counter. Preparation and analysis also use the main conversation's allowance, and other account activity can contaminate the difference. [Official usage guidance](https://learn.chatgpt.com/docs/pricing#what-are-the-usage-limits-for-my-plan) explains why model, context, reasoning, tools and caching all affect allowance.

For a later study, use multiple representative tasks and repeat each arm with balanced order. Report failures and total attempted tokens alongside success rate. A 27-run study (3 tasks × 3 workflows × 3 repeats) is a separate workload; extrapolating this small routine fixture to harder tasks would not be reliable.

## Artifacts

Each output directory contains settings/hashes, the exact prompt, a report, raw native output, metadata-only hook records, acceptance results and the final source/diff. Raw logs stay in ignored `dist/` because they contain local paths and task context. Only a reviewed, aggregate report should be committed.
