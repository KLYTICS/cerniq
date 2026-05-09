#!/usr/bin/env node
// Pre-mint a pool of N freshly-signed verify tokens and write them to a
// newline-delimited file. The k6 verify load script reads the pool via
// SharedArray and round-robins per-iteration so each request carries a
// distinct `jti` — exercising approve-throughput rather than the system's
// (correctly enforced) replay-protection rejection of token reuse.
//
// Why pre-minted: k6's JS runtime (goja) lacks native Ed25519 and the SDK's
// async bcrypt — minting in-VU would skew the latency profile. The pool is
// ~1k tokens for a 60s × 50 RPS run (3000 reqs); the script wraps if the
// load exceeds the pool size (acceptable since wrapped tokens hit replay
// protection only after the pool has rotated).
//
// Usage:
//   AGENT_ID=agt_… POLICY_ID=pol_… PRIV_FILE=…/dev-agent.private \
//   POOL_SIZE=2000 OUT=/tmp/aegis-token-pool.txt \
//   node tests/load/mint-token-pool.mjs

import { signAgentToken } from '/Users/money/Desktop/AEGIS/packages/sdk-ts/dist/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const AGENT_ID = process.env.AGENT_ID;
const POLICY_ID = process.env.POLICY_ID;
const PRIV_FILE = process.env.PRIV_FILE;
const OUT = process.env.OUT ?? '/tmp/aegis-token-pool.txt';
const POOL_SIZE = Number(process.env.POOL_SIZE ?? 2000);

if (!AGENT_ID || !POLICY_ID || !PRIV_FILE) {
  console.error('AGENT_ID, POLICY_ID, PRIV_FILE all required');
  process.exit(2);
}

const privateKey = readFileSync(PRIV_FILE, 'utf-8').trim();
const tokens = [];
const t0 = Date.now();
for (let i = 0; i < POOL_SIZE; i += 1) {
  // Each call mints a fresh `jti` (ulid in the SDK), so every token is unique.
  const tok = await signAgentToken(privateKey, AGENT_ID, POLICY_ID, {
    action: 'commerce.purchase',
    amount: 199,
    currency: 'USD',
    merchantDomain: 'delta.com',
    ttlSeconds: 3600,
  });
  tokens.push(tok);
}
const t1 = Date.now();

writeFileSync(OUT, tokens.join('\n') + '\n');
process.stdout.write(`minted ${tokens.length} tokens in ${t1 - t0}ms → ${OUT}\n`);
