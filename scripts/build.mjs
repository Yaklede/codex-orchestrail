import { build } from 'esbuild';
import fs from 'node:fs/promises';
await build({
  entryPoints: ['packages/runtime/src/cli.ts'],
  outfile: 'plugins/orchestrail/scripts/orchestrail.mjs',
  bundle: true, platform: 'node', target: 'node22', format: 'esm',
  legalComments: 'eof', banner: { js: '#!/usr/bin/env node' },
});
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) await fs.copyFile(file, `plugins/orchestrail/${file}`);
