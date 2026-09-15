# Distribution and releases

## GitHub

The repository is the Codex marketplace source. `.agents/plugins/marketplace.json` selects `plugins/orchestrail`. GitHub installs use the committed bundle, not TypeScript sources or `node_modules`.

After the repository/ref is published:

```bash
codex plugin marketplace add Yaklede/codex-orchestrail --ref main
codex plugin add orchestrail@orchestrail
```

For a versioned install, choose a published tag using `--ref v0.3.0`. Do not present an unpublished tag as available.

To prepare a release, align `package.json` and the base version of `.codex-plugin/plugin.json`, run `pnpm package`, and include the regenerated bundle in the reviewed commit. A `+codex.…` build metadata suffix distinguishes local plugin cache updates without changing the runtime version. The release workflow runs when a matching `v*` tag is pushed; it checks the version and creates a GitHub release with both archives and `SHA256SUMS`. Creating local packages does not push commits or tags. No official OpenAI directory submission is part of this release path.

## Local development

```bash
codex plugin marketplace add /absolute/path/to/codex-orchestrail
codex plugin add orchestrail@orchestrail
```

After editing an already installed local plugin, rebuild, validate the repo marketplace name, and use the plugin-creator cachebuster/reinstall workflow available in the Codex development environment. Do not manually change installed cache files. Reinstall from the same marketplace and open a new Codex task so it reads the updated skills/hooks. Existing project profiles are updated by the setup skill, subject to ownership checks.

## OpenDock preparation

```bash
pnpm package:opendock
cd dist/opendock
```

This directory is the package root. It contains `dock.yml`, `DOCK.md`, licenses, and all payload files. The complete `pnpm package` command also creates a compressed OpenDock archive.

The [OpenDock manifest guide](https://opendock.app/docs/?lang=ko&theme=dark) documents `opendock: 1`, project-relative file mappings, runtime requirements, doctor checks and submission review. The generated package uses those fields. No install command downloads or builds code; the payload is already bundled.

When you are ready to publish, authenticate with OpenDock and replace `YOUR_OWNER` with a namespace you control. From the generated package root, a submission command has this form:

```bash
opendock deploy YOUR_OWNER/orchestrail@0.3.0 --file dock.yml --platform macos
```

Submit for Linux separately after validating that target. Do not claim Windows support from a macOS test. Publishing is separate from preparation and may require review. The GitHub owner name does not establish an OpenDock namespace. No registry credentials are stored in this repository and CI does not submit to OpenDock.

## Ownership

The native setup helper owns only profiles it actually writes and records their checksums. Removal preserves edited files and run history. Identical pre-existing profiles are not silently claimed by the native installer.

OpenDock owns its payload files and the managed AGENTS.md block. Its file planner keeps agent SKILL.md files intact instead of surrounding their frontmatter with managed Markdown markers. Use OpenDock update/uninstall for that installation. Changing an OpenDock-owned profile via setup is a user modification from OpenDock's perspective and may require reconciliation before update. Preserve those choices rather than forcing an overwrite.
