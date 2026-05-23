#!/usr/bin/env node
// Regenerates the @cerniq/sdk TypeScript reference under
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

const child = spawn('typedoc', ['--options', resolve(appRoot, 'typedoc.json')], {
  cwd: appRoot,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  if (code === 0) {
    console.log(
      '[docs] SDK TypeScript reference regenerated under content/docs/sdk/(generated)/typescript',
    );
    process.exit(0);
    return;
  }
  // Graceful degradation: TypeDoc + typedoc-plugin-markdown have version-coupled
  // peer constraints (plugin v4.11 wants typedoc 0.28; typedoc 0.28 wants TS <= 5.8;
  // we run TS 5.9). Until the upstream chain catches up, the SDK autogen is best-
  // effort — the curated content/docs/sdk/typescript.mdx remains the v1 source.
  // We DO NOT fail the build on TypeDoc errors; we leave a visible warning so
  // operators know the (generated) directory may be stale.
  console.warn(
    `[docs] TypeDoc exited with code ${code} — SDK auto-reference SKIPPED. ` +
      'The curated content/docs/sdk/typescript.mdx remains authoritative until ' +
      'typedoc + typedoc-plugin-markdown + TS versions align upstream.',
  );
  process.exit(0);
});
