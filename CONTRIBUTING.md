# Contributing

Use Node 22+ and the pnpm version pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm package
```

Keep changes to the runtime in `packages/runtime/src/`. Rebuild and commit the generated `plugins/orchestrail/scripts/orchestrail.mjs`; GitHub plugin users do not install development dependencies. Keep the root version and plugin manifest's base version aligned; local plugin cache updates can add a `+codex.…` suffix. The runtime reads the root package version during bundling.

Add behavioral tests for changes to routing, evidence, state recovery, ownership, or host compatibility. Document whether a claim was established by a local fixture, a native Codex run, or a registry submission. The optional `smoke:native` and `smoke:harness` commands use real models and are not part of CI.

Preserve the host's permissions, model choices, and user-owned files. Keep provider-specific behavior in the hook adapter. Do not add transcript parsing, external model execution, automatic billing estimates, or release credentials to the plugin.

Before submitting a change, describe the concrete behavior changed and the validation performed. See [distribution](docs/distribution.md) for release and local reinstall steps.
