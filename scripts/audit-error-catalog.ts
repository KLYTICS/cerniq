#!/usr/bin/env tsx
/**
 * audit-error-catalog — CI-style guard that every `throw new <X>Error(...)`
 * call in apps/api/src has a matching entry in ERROR_CATALOG.
 *
 * Usage:
 *   tsx audit-error-catalog.ts          # fail with non-zero on any drift
 *   tsx audit-error-catalog.ts --list   # print the full catalog + scan summary, never fail
 *
 * Why this exists: the catalog is only useful if it cannot drift from the
 * source. ESLint can't enforce "every thrown error class is in this object
 * literal" without a custom rule, so we run a regex scan in CI instead.
 *
 * NOTE: We deliberately whitelist NestJS-native HttpException subclasses
 * (NotFoundException, ForbiddenException, etc.) — they are framework-issued
 * and the global filter handles them generically. The audit only enforces
 * coverage for CERNIQ-owned `*Error` classes.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

// Cross-package data load: scripts is ESM, apps/api is CommonJS, so a
// top-level static import of ERROR_CATALOG hits a module-format mismatch
// at run-time. We dynamically import the catalog inside main() — tsx
// transpiles the .ts source under either format. The audit script reads
// the live catalog (not a copy) so it cannot drift.
// Type-only re-declaration: importing the .ts source for types would
// require allowImportingTsExtensions (off in scripts/tsconfig.json) and
// importing as .js fails at runtime under tsx because apps/api is CJS.
// The audit script only needs the shape, not the value, so we mirror it
// here. If error-catalog.ts adds a field, this declaration must follow
// — the spec under apps/api guards correctness; this is purely cosmetic.
interface ErrorCatalogEntry {
  code: string;
  httpStatus: number;
  retryable: boolean;
  backoff?: 'none' | 'linear' | 'exponential' | 'on_retry_after_header';
  customerMessage: string;
  category:
    | 'auth'
    | 'validation'
    | 'policy'
    | 'rate_limit'
    | 'billing'
    | 'crypto'
    | 'transient'
    | 'internal';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const SCAN_ROOT = resolve(REPO_ROOT, 'apps/api/src');

/** NestJS-native exceptions we do NOT require in the catalog. */
const FRAMEWORK_EXCEPTIONS = new Set<string>([
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'NotFoundException',
  'ConflictException',
  'GoneException',
  'PreconditionFailedException',
  'PayloadTooLargeException',
  'UnsupportedMediaTypeException',
  'UnprocessableEntityException',
  'InternalServerErrorException',
  'NotImplementedException',
  'BadGatewayException',
  'ServiceUnavailableException',
  'GatewayTimeoutException',
  'HttpException',
]);

/** Third-party / std-lib error classes we tolerate without a catalog entry. */
const ALLOWED_NON_CATALOG_ERRORS = new Set<string>([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  // Zod / Prisma — surfaced and translated upstream, not thrown raw to clients.
  'ZodError',
  'PrismaClientKnownRequestError',
  'PrismaClientValidationError',
]);

interface Finding {
  className: string;
  file: string;
  line: number;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (st.isFile()) {
      if (full.endsWith('.ts') && !full.endsWith('.spec.ts') && !full.endsWith('.d.ts')) {
        out.push(full);
      }
    }
  }
  return out;
}

function scanFile(file: string, findings: Finding[]): void {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  // Match `throw new <Identifier>(...)` where the identifier ends in
  // Error or Exception. Multiline-aware via per-line scan.
  const re = /throw\s+new\s+([A-Z][A-Za-z0-9_]*(?:Error|Exception))\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const className = m[1];
      if (className === undefined) continue;
      findings.push({ className, file, line: i + 1 });
    }
  }
}

async function loadCatalog(): Promise<Readonly<Record<string, ErrorCatalogEntry>>> {
  // Dynamic import sidesteps the ESM-vs-CJS top-level resolution. tsx will
  // transpile the .ts source on demand. The named export is the live
  // ERROR_CATALOG from apps/api/src/common/errors/error-catalog.ts.
  // String-form specifier (no .ts in a type position) keeps tsc happy
  // without `allowImportingTsExtensions`, while tsx still resolves the
  // .ts source on disk at run-time.
  const specifier = '../apps/api/src/common/errors/error-catalog.ts';
  const mod = (await import(specifier)) as {
    ERROR_CATALOG: Readonly<Record<string, ErrorCatalogEntry>>;
  };
  return mod.ERROR_CATALOG;
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  const listMode = args.has('--list');

  const ERROR_CATALOG = await loadCatalog();

  const files = walk(SCAN_ROOT);
  const findings: Finding[] = [];
  for (const f of files) scanFile(f, findings);

  const thrownClassNames = new Set(findings.map((f) => f.className));
  const cataloged = new Set(Object.keys(ERROR_CATALOG));

  // Drift = thrown but not in catalog and not framework-allowed.
  const uncataloged: string[] = [];
  for (const name of thrownClassNames) {
    if (cataloged.has(name)) continue;
    if (FRAMEWORK_EXCEPTIONS.has(name)) continue;
    if (ALLOWED_NON_CATALOG_ERRORS.has(name)) continue;
    uncataloged.push(name);
  }

  if (listMode) {
    process.stdout.write('=== ERROR_CATALOG entries ===\n');
    for (const [name, entry] of Object.entries(ERROR_CATALOG)) {
      process.stdout.write(
        `  ${name.padEnd(30)} code=${entry.code.padEnd(24)} http=${entry.httpStatus} retryable=${String(
          entry.retryable,
        ).padEnd(5)} category=${entry.category}\n`,
      );
    }
    process.stdout.write(
      `\n=== Thrown classes found in apps/api/src (${thrownClassNames.size}) ===\n`,
    );
    for (const name of [...thrownClassNames].sort()) {
      const tag = cataloged.has(name)
        ? 'CATALOG'
        : FRAMEWORK_EXCEPTIONS.has(name)
          ? 'NEST   '
          : ALLOWED_NON_CATALOG_ERRORS.has(name)
            ? 'ALLOW  '
            : 'MISSING';
      process.stdout.write(`  [${tag}] ${name}\n`);
    }
    process.stdout.write(
      `\nFiles scanned: ${files.length}; throw sites: ${findings.length}; uncataloged: ${uncataloged.length}\n`,
    );
    return 0;
  }

  if (uncataloged.length > 0) {
    process.stderr.write('Uncataloged error classes thrown in apps/api/src:\n');
    for (const name of uncataloged.sort()) {
      const sample = findings.find((f) => f.className === name);
      const where = sample
        ? `${sample.file.replace(REPO_ROOT + '/', '')}:${sample.line}`
        : '(unknown)';
      process.stderr.write(`  - ${name}  (first seen at ${where})\n`);
    }
    process.stderr.write(
      `\nAdd entries to apps/api/src/common/errors/error-catalog.ts (ERROR_CATALOG) for each class above, then re-run.\n`,
    );
    return 1;
  }

  process.stdout.write(
    `audit-error-catalog: OK — ${thrownClassNames.size} thrown classes across ${files.length} files all covered.\n`,
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(
      `audit-error-catalog: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(2);
  },
);
