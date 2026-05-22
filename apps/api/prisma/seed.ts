// Local development seed.
//
// Creates a single principal with a full API key and a verify-only key, plus
// one demo agent + policy you can use to drive the verify hot path. Prints
// the plaintext keys ONCE (since storage is bcrypt-hashed) — copy them into
// your `.env` before running e2e tests.
//
// Run: pnpm --filter @okoro/api db:seed

import { randomBytes, generateKeyPairSync } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ulid } from 'ulid';

const prisma = new PrismaClient();

const SEED_PRINCIPAL_EMAIL = 'dev@okorolabs.io';
const BCRYPT_COST = 4; // dev-only: keep fast.

async function main(): Promise<void> {
  console.warn('OKORO — seeding local dev data');

  const principal = await prisma.principal.upsert({
    where: { email: SEED_PRINCIPAL_EMAIL },
    update: {},
    create: {
      email: SEED_PRINCIPAL_EMAIL,
      name: 'OKORO local dev',
      planTier: 'DEVELOPER',
      emailVerified: true,
    },
  });
  console.warn(`  principal: ${principal.id} (${principal.email})`);

  // ── API keys (plaintext printed once; only the bcrypt hash persists)
  const fullKeyPlain = `okoro_sk_${b58(randomBytes(21))}`;
  const verifyKeyPlain = `okoro_vk_${b58(randomBytes(21))}`;

  await prisma.apiKey.upsert({
    where: { keyHash: await bcrypt.hash('seed-marker-full', 4) },
    update: {},
    create: {
      keyHash: await bcrypt.hash(fullKeyPlain, BCRYPT_COST),
      keyPrefix: fullKeyPlain.slice(0, 12),
      label: 'seed: full',
      principalId: principal.id,
      scope: 'FULL',
    },
  });
  await prisma.apiKey.create({
    data: {
      keyHash: await bcrypt.hash(verifyKeyPlain, BCRYPT_COST),
      keyPrefix: verifyKeyPlain.slice(0, 12),
      label: 'seed: verify-only',
      principalId: principal.id,
      scope: 'VERIFY_ONLY',
    },
  });
  console.warn('  api key (FULL):       ', fullKeyPlain);
  console.warn('  api key (VERIFY_ONLY):', verifyKeyPlain);

  // ── Demo agent (fresh Ed25519 keypair generated locally; private key NOT persisted)
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyB64Url = publicKey.export({ format: 'jwk' }).x ?? '';

  const agent = await prisma.agentIdentity.upsert({
    where: { id: 'agt_seed_demo_01' },
    update: {},
    create: {
      id: 'agt_seed_demo_01',
      publicKey: publicKeyB64Url,
      principalId: principal.id,
      runtime: 'ANTHROPIC',
      model: 'claude-sonnet-4-5',
      label: 'Demo agent (seed)',
      status: 'ACTIVE',
      trustScore: 600,
      trustBand: 'VERIFIED',
    },
  });

  await prisma.agentPolicy.upsert({
    where: { id: 'pol_seed_demo_01' },
    update: {},
    create: {
      id: 'pol_seed_demo_01',
      agentId: agent.id,
      label: 'Demo policy: shopping under $500',
      signedToken: `seed.${ulid()}.placeholder-replace-on-real-issuance`,
      tokenHash: ulid(),
      status: 'ACTIVE',
      scopes: [
        {
          category: 'commerce',
          spendLimit: { currency: 'USD', maxPerTransaction: 500, maxPerDay: 1000, maxPerMonth: 5000 },
          allowedDomains: ['delta.com', 'united.com', 'southwest.com'],
        },
      ],
      expiresAt: new Date(Date.now() + 7 * 86_400_000), // +7 days
    },
  });

  // ── Verified relying party (so report() calls weight properly)
  await prisma.relyingParty.upsert({
    where: { domain: 'delta.com' },
    update: {},
    create: {
      name: 'Delta Air Lines (seed)',
      domain: 'delta.com',
      apiKeyHash: await bcrypt.hash(`okoro_vk_seed_${b58(randomBytes(8))}`, BCRYPT_COST),
      reportWeight: 1.0,
      verified: true,
      verifiedAt: new Date(),
    },
  });

  console.warn(`  agent:  ${agent.id}`);
  console.warn('  agent privateKey (DO NOT log in production — for local testing only):');
  console.warn('    ', privateKey.export({ format: 'jwk' }).d);
  console.warn('seed done');
}

function b58(buf: Buffer): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let acc = 0n;
  for (const b of buf) acc = (acc << 8n) | BigInt(b);
  let out = '';
  while (acc > 0n) {
    out = (ALPHABET[Number(acc % 58n)] ?? '1') + out;
    acc /= 58n;
  }
  return out.padStart(28, '1').slice(0, 28);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
