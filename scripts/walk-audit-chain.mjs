#!/usr/bin/env node
// AEGIS — third-party-style audit-chain walker.
//
// Fetches an NDJSON audit export from the live API, fetches the JWKS,
// then runs the chain through `@aegis/audit-verifier`. This is the
// canonical "auditor's reproduction" path — if THIS script reports a
// clean chain, the SOC2 third-party-verification story works.
//
// Usage:
//   node scripts/walk-audit-chain.mjs \
//       --export ./audit-export.ndjson \
//       --jwks   http://localhost:4000/.well-known/jwks.json
//
// or (against a running API):
//   node scripts/walk-audit-chain.mjs \
//       --api    http://localhost:4000 \
//       --agent  cmoz0kix2015mwphsw7q2k8b9 \
//       --key    "<X-AEGIS-API-Key>"
//
// Done-when assertions (per the M-038 brief):
//   kidInJwks   === totalRows                — every row's signingKeyId
//                                              resolves to a published JWK.
//   linkValid   === totalRows - 1            — every non-genesis row's
//                                              chain link reconstructs.
//   sigValid    === totalRows                — every row's signature
//                                              verifies against the
//                                              resolved public key.
//
// Exit codes:
//   0   chain intact + all assertions hold
//   1   chain broke OR an assertion failed
//   2   usage / I/O error

import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { verifyChain } from '@aegis/audit-verifier';

const { values: opts } = parseArgs({
  options: {
    export: { type: 'string' },
    jwks: { type: 'string' },
    api: { type: 'string' },
    agent: { type: 'string' },
    key: { type: 'string' },
    'fail-fast': { type: 'boolean', default: false },
  },
});

async function loadExport() {
  if (opts.export) {
    const body = await readFile(opts.export, 'utf8');
    return body
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  if (opts.api && opts.agent && opts.key) {
    const url = `${opts.api.replace(/\/$/, '')}/v1/agents/${opts.agent}/audit/export.ndjson`;
    const res = await fetch(url, { headers: { 'X-AEGIS-API-Key': opts.key } });
    if (!res.ok) throw new Error(`export fetch failed: ${res.status} ${res.statusText}`);
    const body = await res.text();
    return body
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  throw new Error('provide --export <file> OR --api/--agent/--key');
}

async function loadJwks() {
  const url = opts.jwks ?? (opts.api ? `${opts.api.replace(/\/$/, '')}/.well-known/jwks.json` : null);
  if (!url) throw new Error('provide --jwks <url> or --api <url>');
  const res = await fetch(url, { headers: { accept: 'application/jwk-set+json' } });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

try {
  const rows = await loadExport();
  const jwks = await loadJwks();
  const jwksKids = new Set(jwks.keys.map((k) => k.kid));

  // The verifier already does sig + chain-link checks. We layer the
  // counting here so the script's stdout matches the brief's "Done when"
  // schema exactly — auditors should be able to grep these field names.
  const report = await verifyChain(rows, { jwks, failFast: !!opts['fail-fast'], maxRowDetail: rows.length });

  let kidInJwks = 0;
  let sigValid = 0;
  let linkValid = 0;
  for (let i = 0; i < report.rows.length; i++) {
    const r = report.rows[i];
    if (jwksKids.has(r.signingKeyId)) kidInJwks += 1;
    if (r.signatureValid) sigValid += 1;
    if (r.chainLinkValid) linkValid += 1;
  }

  const summary = {
    totalRows: report.totalRows,
    kidInJwks,
    sigValid,
    linkValid,
    rotationEvents: report.rotationEvents,
    signingKeys: report.signingKeys,
    valid: report.valid,
    firstBreak: report.firstBreak,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');

  const assertions = [
    ['kidInJwks === totalRows', summary.kidInJwks === summary.totalRows],
    ['linkValid === totalRows - 1', summary.linkValid === summary.totalRows - 1],
    ['sigValid === totalRows', summary.sigValid === summary.totalRows],
  ];
  const failed = assertions.filter(([, ok]) => !ok);
  if (failed.length === 0 && summary.valid) {
    process.stderr.write('chain intact — all assertions hold\n');
    process.exit(0);
  }
  for (const [name] of failed) process.stderr.write(`FAIL: ${name}\n`);
  if (!summary.valid) process.stderr.write(`FAIL: report.valid === false\n`);
  process.exit(1);
} catch (err) {
  process.stderr.write(`fatal: ${err.message}\n`);
  process.exit(2);
}
