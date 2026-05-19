#!/usr/bin/env node
// Generates MDX files under content/docs/api/(generated)/ from the canonical
// OpenAPI spec at docs/spec/AEGIS_API_SPEC.yaml. Runs pre-build and pre-dev
// (see prebuild + predev in package.json).
//
// The (generated) route segment is a Next.js route group — gitignored output
// that doesn't appear in the URL. Hand-written API pages live alongside
// (e.g. content/docs/api/agents.mdx) and remain authoritative; generated
// pages are the OpenAPI-derived reference with try-it-out.

import { generateFiles } from 'fumadocs-openapi';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..');

await generateFiles({
  input: [resolve(repoRoot, 'docs/spec/AEGIS_API_SPEC.yaml')],
  output: resolve(__dirname, '..', 'content/docs/api/(generated)'),
  per: 'operation',
  groupBy: 'tag',
});

console.log('[docs] OpenAPI MDX regenerated under content/docs/api/(generated)');
