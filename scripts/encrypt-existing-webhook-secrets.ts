#!/usr/bin/env -S node --import=tsx
/**
 * OKORO — one-shot bulk-encryptor for legacy plaintext webhook secrets.
 *
 * Round 12 shipped envelope encryption for `WebhookSubscription.secret`
 * (see `apps/api/src/common/crypto/webhook-secret-cipher.ts`). New rows
 * encrypt-on-write; the delivery worker decrypts just-before-HMAC-sign
 * with an `isEncrypted()` legacy detector that allows pre-existing
 * plaintext rows to keep flowing.
 *
 * This script migrates those legacy plaintext rows to ciphertext so
 * operators can (a) rotate the DEK and (b) drop the legacy plaintext
 * branch in `webhook.delivery.ts` in a follow-up round.
 *
 * Idempotent — running twice is a no-op on the second pass.
 *
 * Usage (operator-facing, runbook-grade):
 *
 *   pnpm --filter @okoro/scripts encrypt-webhook-secrets -- --dry-run
 *   pnpm --filter @okoro/scripts encrypt-webhook-secrets
 *
 * Exit codes:
 *   0  success, every row either skipped (already-encrypted) or migrated
 *   1  some rows failed; partial progress was committed (see stdout JSON)
 *   2  CLI usage error
 *   3  config error (missing OKORO_WEBHOOK_SECRET_DEK_B64)
 *
 * Final stdout line is structured JSON for CI grep:
 *   { ok, total, alreadyEncrypted, encrypted, failed, durationMs, dryRun }
 */

import { stderr, stdout, exit, argv, env } from 'node:process';

import { Command, Option } from 'commander';
import { PrismaClient } from '@prisma/client';

// Cross-package access to the canonical WebhookSecretCipher in apps/api.
// We load it via a runtime dynamic import because scripts/tsconfig.json
// pins `rootDir: "."`, so a static import would trip TS6059 not just on
// the cipher itself but on every transitive file (okoro-error,
// config.service, config.schema). Dynamic specifiers escape rootDir
// analysis; tsx resolves the path at runtime exactly the same way.
//
// The cipher's public surface (what we call) is:
//   constructor(config: { webhookSecretDekB64?: string; nodeEnv: string })
//   isEncrypted(value: string): boolean
//   encrypt(plaintext: string): string
// We re-declare it structurally below so the rest of this file stays
// fully type-checked.

interface RuntimeCipher {
  isEncrypted(value: string): boolean;
  encrypt(plaintext: string): string;
}

interface CipherConfigShim {
  webhookSecretDekB64: string;
  nodeEnv: 'production' | 'development' | 'test';
}

interface CipherCtor {
  new (config: CipherConfigShim): RuntimeCipher;
}

async function loadWebhookSecretCipher(): Promise<CipherCtor> {
  // Variable specifier prevents TS from following the import statically.
  const specifier = '../apps/api/src/common/crypto/webhook-secret-cipher.js';
  // type-rationale: the dynamic import returns `unknown`-shaped module
  // metadata; we narrow to the exported class via a single structural cast.
  const mod = (await import(specifier)) as { WebhookSecretCipher: CipherCtor };
  if (typeof mod.WebhookSecretCipher !== 'function') {
    throw new Error(
      `webhook-secret-cipher module did not export a WebhookSecretCipher class (got ${typeof mod.WebhookSecretCipher})`,
    );
  }
  return mod.WebhookSecretCipher;
}

// ── Types ─────────────────────────────────────────────────────────

export interface EncryptOutcome {
  ok: boolean;
  total: number;
  alreadyEncrypted: number;
  encrypted: number;
  failed: number;
  durationMs: number;
  dryRun: boolean;
}

export interface EncryptOptions {
  dryRun: boolean;
  batchSize: number;
  limit?: number;
  principalId?: string;
  /** If set, called once per row with a structured progress event. */
  onRow?: (event: RowEvent) => void;
}

export type RowEvent =
  | { kind: 'already-encrypted'; id: string }
  | { kind: 'encrypted'; id: string; dryRun: boolean }
  | { kind: 'failed'; id: string; reason: string };

/**
 * Minimal Prisma surface the migrator depends on. Lets the spec inject a
 * mock without booting a real client. Keep this narrow — adding fields here
 * means real call-sites must satisfy them.
 */
export interface WebhookRow {
  id: string;
  secret: string;
}

export interface MigratorPrisma {
  webhookSubscription: {
    findMany(args: {
      where?: { principalId?: string; id?: { gt: string } };
      orderBy: { id: 'asc' };
      take: number;
    }): Promise<WebhookRow[]>;
    update(args: { where: { id: string }; data: { secret: string } }): Promise<unknown>;
  };
}

/**
 * Subset of the cipher that this migrator depends on. Lets the spec swap
 * in a fake without instantiating the real class.
 */
export interface MigratorCipher {
  isEncrypted(value: string): boolean;
  encrypt(plaintext: string): string;
}

// ── Core algorithm (testable, framework-free) ─────────────────────

const DEFAULT_BATCH_SIZE = 1000;

export async function encryptExistingWebhookSecrets(
  prisma: MigratorPrisma,
  cipher: MigratorCipher,
  opts: EncryptOptions,
): Promise<EncryptOutcome> {
  if (opts.batchSize <= 0) {
    throw new RangeError(`batchSize must be > 0; got ${opts.batchSize}`);
  }

  const startedAt = Date.now();
  let total = 0;
  let alreadyEncrypted = 0;
  let encrypted = 0;
  let failed = 0;
  let cursor: string | null = null;

  // Cursor pagination by id ASC. Avoids OFFSET-style scans that slow down
  // linearly past row 100k. We re-query each batch until findMany returns
  // a partial page (less than batchSize) — that's the signal we're done.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (opts.limit !== undefined && total >= opts.limit) break;

    const remaining =
      opts.limit !== undefined ? Math.max(0, opts.limit - total) : Number.POSITIVE_INFINITY;
    const take = Math.min(opts.batchSize, remaining);
    if (take <= 0) break;

    const where: { principalId?: string; id?: { gt: string } } = {};
    if (opts.principalId) where.principalId = opts.principalId;
    if (cursor !== null) where.id = { gt: cursor };

    const batch = await prisma.webhookSubscription.findMany({
      where,
      orderBy: { id: 'asc' },
      take,
    });
    if (batch.length === 0) break;

    for (const row of batch) {
      total++;
      cursor = row.id;

      if (cipher.isEncrypted(row.secret)) {
        alreadyEncrypted++;
        opts.onRow?.({ kind: 'already-encrypted', id: row.id });
        continue;
      }

      try {
        const ciphertext = cipher.encrypt(row.secret);
        if (!opts.dryRun) {
          await prisma.webhookSubscription.update({
            where: { id: row.id },
            data: { secret: ciphertext },
          });
        }
        encrypted++;
        opts.onRow?.({ kind: 'encrypted', id: row.id, dryRun: opts.dryRun });
      } catch (err) {
        failed++;
        const reason = err instanceof Error ? err.message : String(err);
        opts.onRow?.({ kind: 'failed', id: row.id, reason });
      }
    }

    if (batch.length < take) break;
  }

  return {
    ok: failed === 0,
    total,
    alreadyEncrypted,
    encrypted,
    failed,
    durationMs: Date.now() - startedAt,
    dryRun: opts.dryRun,
  };
}

// ── Config shim for the cipher ────────────────────────────────────

/**
 * Build the minimal shim the cipher constructor reads. The real
 * `AppConfigService` exposes ~70 getters; we only need the two below.
 * `nodeEnv: 'production'` is correct here even when the operator is
 * running locally because we want fail-loud behaviour: a missing DEK
 * must abort, never silently mint an ephemeral one.
 */
export function buildCipherConfigShim(dekB64: string): CipherConfigShim {
  return {
    webhookSecretDekB64: dekB64,
    nodeEnv: 'production',
  };
}

// ── CLI entry ─────────────────────────────────────────────────────

interface CliOpts {
  dryRun: boolean;
  batchSize: number;
  limit?: number;
  principalId?: string;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('encrypt-existing-webhook-secrets')
    .description(
      'One-shot migrator: encrypt every legacy plaintext WebhookSubscription.secret in the database.',
    )
    .addOption(
      new Option('--dry-run', 'log what would be encrypted but write nothing').default(false),
    )
    .addOption(
      new Option('--batch-size <n>', 'rows per page (cursor pagination)')
        .default(DEFAULT_BATCH_SIZE)
        .argParser((v) => {
          const n = Number.parseInt(v, 10);
          if (!Number.isFinite(n) || n <= 0) {
            throw new TypeError(`--batch-size must be a positive integer; got ${v}`);
          }
          return n;
        }),
    )
    .addOption(
      new Option('--limit <n>', 'cap total rows visited (test/safety)').argParser((v) => {
        const n = Number.parseInt(v, 10);
        if (!Number.isFinite(n) || n < 0) {
          throw new TypeError(`--limit must be a non-negative integer; got ${v}`);
        }
        return n;
      }),
    )
    .addOption(
      new Option('--principal-id <id>', 'restrict to one tenant (incident-response use)'),
    );

  try {
    program.parse(argv);
  } catch (err) {
    stderr.write(`usage error: ${(err as Error).message}\n`);
    exit(2);
  }

  const opts = program.opts<CliOpts>();

  const dekB64 = env.OKORO_WEBHOOK_SECRET_DEK_B64;
  if (!dekB64 || dekB64.length === 0) {
    stderr.write(
      'OKORO_WEBHOOK_SECRET_DEK_B64 is required. Generate with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"\n',
    );
    exit(3);
  }

  if (!env.DATABASE_URL || env.DATABASE_URL.length === 0) {
    stderr.write('DATABASE_URL is required\n');
    exit(2);
  }

  let cipher: RuntimeCipher;
  try {
    const Ctor = await loadWebhookSecretCipher();
    cipher = new Ctor(buildCipherConfigShim(dekB64));
  } catch (err) {
    stderr.write(`failed to initialise cipher: ${(err as Error).message}\n`);
    exit(3);
  }

  stdout.write(
    `[encrypt-webhook-secrets] starting — dryRun=${opts.dryRun} batchSize=${opts.batchSize}` +
      (opts.limit !== undefined ? ` limit=${opts.limit}` : '') +
      (opts.principalId ? ` principalId=${opts.principalId}` : '') +
      '\n',
  );

  const prisma = new PrismaClient();
  try {
    const outcome = await encryptExistingWebhookSecrets(
      prisma as unknown as MigratorPrisma,
      cipher,
      {
        dryRun: opts.dryRun,
        batchSize: opts.batchSize,
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.principalId ? { principalId: opts.principalId } : {}),
        onRow: (ev) => {
          if (ev.kind === 'failed') {
            stderr.write(`[FAIL] ${ev.id}: ${ev.reason}\n`);
          } else if (ev.kind === 'encrypted') {
            stdout.write(`[${ev.dryRun ? 'DRY ' : 'OK  '}] ${ev.id}\n`);
          }
          // already-encrypted rows are not logged per-row to keep the
          // re-run output small. The final JSON carries the count.
        },
      },
    );

    // Final structured JSON line — CI greps this.
    stdout.write(`${JSON.stringify(outcome)}\n`);
    exit(outcome.failed === 0 ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

const isMain =
  argv[1] !== undefined &&
  (argv[1].endsWith('encrypt-existing-webhook-secrets.ts') ||
    argv[1].endsWith('encrypt-existing-webhook-secrets.js'));
if (isMain) {
  main().catch((err) => {
    stderr.write(`fatal: ${(err as Error).message}\n`);
    exit(1);
  });
}
