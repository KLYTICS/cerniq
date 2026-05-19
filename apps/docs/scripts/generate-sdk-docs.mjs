#!/usr/bin/env node
// Regenerates the @aegis/sdk TypeScript reference under
// content/docs/sdk/(generated)/typescript/ via TypeDoc + typedoc-plugin-markdown.
//
// The (generated) route segment is gitignored — the source of truth is
// packages/sdk-ts/src/**. Runs pre-build and pre-dev (see package.json).

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appRoot = resolve(__dirname, '..');

const child = spawn(
  'typedoc',
  ['--options', resolve(appRoot, 'typedoc.json')],
  {
    cwd: appRoot,
    stdio: 'inherit',
    shell: true,
  },
);

child.on('exit', (code) => {
  if (code === 0) {
    console.log('[docs] SDK TypeScript reference regenerated under content/docs/sdk/(generated)/typescript');
  } else {
    console.warn(
      `[docs] TypeDoc exited with code ${code} — SDK reference may be stale. ` +
        'Run `pnpm --filter @aegis/docs sdk:generate` after `pnpm install` to populate.',
    );
  }
  process.exit(code ?? 1);
});
