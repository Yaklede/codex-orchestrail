# Project model and reasoning preferences

The helper resolves its plugin root automatically. Pass `--project PROJECT` and write JSON with a file tool, then use `--input FILE`, or supply JSON on stdin. These settings commands do not require a run/session and never change the Codex account or main conversation model.

## Inspect

`config` returns `configured`, the current `config`, a `configHash`, effort values and presets. For an unconfigured project the table is a proposal, not a saved choice.

| Preset | Scout | Builder | Reviewer | Expert |
| --- | --- | --- | --- | --- |
| `balanced` | medium | high | high | high |
| `all-medium` | medium | medium | medium | medium |
| `all-high` | high | high | high | high |

Presets change effort only. They preserve model selections and limits. Individual overrides are applied after a preset. Allowed effort strings are `low`, `medium`, `high`, `xhigh`, `max`, `ultra`; the host must also support the chosen model/effort combination.

Ask in the user's language. For example:

> 이 프로젝트의 하위 에이전트 추론 수준을 어떻게 설정할까요? 기본 모델은 Scout/Builder/Reviewer가 Sol, Expert가 Astra입니다.
> - 기본 혼합: Scout medium, 나머지 high
> - 모두 high
> - 직접 지정: 예를 들어 “모두 xhigh, Expert만 max”

For a custom answer, request only the missing values. If the user's answer names all roles or all Sol/Astra work, map it to the relevant roles and avoid further confirmation of an already explicit choice.

## First setup

`setup` with no selected preset or model/effort on a new project returns `installed: false, needsPreferences: true`; it does not write defaults. Once the user chooses:

```json
{"preset":"balanced"}
```

Or use custom values:

```json
{"models":{"scout":{"effort":"xhigh"},"builder":{"effort":"xhigh"},"reviewer":{"effort":"xhigh"},"expert":{"model":"gpt-6-astra","effort":"max"}}}
```

An explicit partial choice uses the proposed defaults for other roles. An existing project's `setup` without input preserves its configuration. `setup` with changed preferences delegates to the same update path as `configure`.

## Change later

Read `config` first, retain its hash, then call `configure` with only requested changes:

```json
{"models":{"builder":{"effort":"medium"}},"expectedConfigHash":"HASH_FROM_CONFIG"}
```

```json
{"models":{"expert":{"model":"gpt-6-astra","effort":"max"}},"expectedConfigHash":"HASH_FROM_CONFIG"}
```

Model identifiers are not limited to Sol/Astra in the configuration. Use the exact user-selected identifier available to native Codex tools. For an unavailable model or unsupported effort, report the limitation and obtain a supported choice; do not silently substitute another model.

`configure` also accepts the existing `limits` fields. Omitted fields remain unchanged. It rejects unknown keys, invalid efforts and a stale `expectedConfigHash` before applying changes. The config and namespaced profile updates share the checkout lock with assignment reservation. Caught write failures attempt to restore prior files; a process crash can still require doctor/setup reconciliation.

The response includes the resulting `config`, `changedRoles`, `configHash`, `appliesTo: "new assignments"`, and affected `unchangedAssignments`. It does not rewrite existing assignments, results, plans or budgets consumed. After a model/effort change, do not reuse an agent that was started with different settings. A previously reserved assignment can still run using its original explicit parameters.

Only changed model/effort fields in the generated top-level TOML header are edited. Other instructions/comments remain intact; unsupported header layouts fail without changing the saved configuration. OpenDock continues to own its files, so modifying those profiles may require reconciliation during a later dock update.
