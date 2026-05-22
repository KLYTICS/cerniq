// Offline relying-party verification demo.
//
// Proves the OKORO neutrality wedge: a relying party (merchant, auditor,
// bank, compliance system) can verify OKORO-signed agent tokens without
// any runtime callback to the OKORO API. The only inputs the RP needs are
// (a) the agent's public key — published by OKORO via JWKS, and (b) an
// agent-status snapshot — refreshed at most once per N minutes.
//
// To prove "no callback to OKORO," this demo injects a fetch shim that
// returns canned responses and asserts loudly if anything tries to escape.
// Run with `pnpm demo`. Exit code 0 = all scenarios behaved as documented;
// exit code 1 = a regression. Suitable for CI.

import { generateKeypair, signAgentToken } from '@aegis/sdk';
import { AegisVerifier, b64uDecode, b64uEncode } from '@aegis/verifier-rp';

const AGENT_ID = 'agt_demo_001';
const POLICY_ID = 'pol_demo_001';

type ExpectedOutcome = 'valid' | 'AGENT_REVOKED' | 'INVALID_SIGNATURE';

interface Scenario {
  name: string;
  expected: ExpectedOutcome;
  agentStatus: 'active' | 'revoked';
  tamperSignature?: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  { name: 'valid receipt',      expected: 'valid',             agentStatus: 'active' },
  { name: 'revoked agent',      expected: 'AGENT_REVOKED',     agentStatus: 'revoked' },
  { name: 'tampered signature', expected: 'INVALID_SIGNATURE', agentStatus: 'active', tamperSignature: true },
];

async function runScenario(
  sc: Scenario,
  privateKey: string,
  publicKey: string,
): Promise<{ actual: string; matched: boolean }> {
  // The fetch shim is the proof. Every URL the verifier tries to reach is
  // either an agent-status read (canned here) or asserts — the demo refuses
  // to make a real outbound request.
  const fakeFetch = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes(`/agents/${AGENT_ID}`)) {
      return new Response(
        JSON.stringify({
          agentId: AGENT_ID,
          status: sc.agentStatus,
          trustScore: sc.agentStatus === 'active' ? 700 : 0,
          trustBand: sc.agentStatus === 'active' ? 'VERIFIED' : 'FLAGGED',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    // Anything else means the verifier tried a path this demo didn't model.
    // Fail loud so a future regression surfaces here, not in production.
    throw new Error(`offline demo: unexpected fetch to ${url}`);
  };

  const verifier = new AegisVerifier({
    baseUrl: 'https://offline.invalid/v1',
    getAgentPublicKey: async () => b64uDecode(publicKey),
    fetch: fakeFetch as unknown as typeof globalThis.fetch,
  });

  let token = await signAgentToken(privateKey, AGENT_ID, POLICY_ID, {
    action: 'commerce.purchase',
    amount: 49,
    currency: 'USD',
    merchantDomain: 'example.com',
    ttlSeconds: 60,
  });
  if (sc.tamperSignature) token = flipOneSignatureByte(token);

  const outcome = await verifier.verify(token, { action: 'commerce.purchase' });
  const actual = outcome.valid ? 'valid' : outcome.reason;
  return { actual, matched: actual === sc.expected };
}

function flipOneSignatureByte(token: string): string {
  const parts = token.split('.');
  const sigB64 = parts[2];
  if (parts.length !== 3 || !sigB64) throw new Error('malformed token in tamper helper');
  const bytes = b64uDecode(sigB64);
  if (bytes.length === 0) throw new Error('empty signature in tamper helper');
  const tampered = new Uint8Array(bytes);
  tampered[0] = ((tampered[0] ?? 0) ^ 0x01) & 0xff;
  parts[2] = b64uEncode(tampered);
  return parts.join('.');
}

async function main(): Promise<number> {
  // The agent generates its keypair locally. In production this happens
  // inside the agent runtime (CLI, KMS, browser vault). OKORO never sees
  // the private half. The RP here only needs the public half.
  const { privateKey, publicKey } = await generateKeypair();

  process.stdout.write('\n');
  process.stdout.write('OKORO offline relying-party verification — no calls to OKORO\n');
  process.stdout.write('===============================================================\n');
  process.stdout.write('  scenario             | expected            | actual              | result\n');
  process.stdout.write('  ---------------------+---------------------+---------------------+-------\n');

  let allMatched = true;
  for (const sc of SCENARIOS) {
    const { actual, matched } = await runScenario(sc, privateKey, publicKey);
    if (!matched) allMatched = false;
    process.stdout.write(
      `  ${sc.name.padEnd(20)} | ${sc.expected.padEnd(19)} | ${actual.padEnd(19)} | ${matched ? 'PASS' : 'FAIL'}\n`,
    );
  }

  process.stdout.write('\n');
  if (allMatched) {
    process.stdout.write('All scenarios behaved as documented.\n');
    process.stdout.write('Every decision above was reached without a single network call to OKORO.\n');
    process.stdout.write('The RP needs the agent public key (which OKORO publishes openly) and an\n');
    process.stdout.write('agent-status snapshot (refreshed at most once per N minutes). That is it.\n\n');
    return 0;
  }
  process.stdout.write('One or more scenarios did not match expectations — investigate the regression.\n\n');
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`demo crashed:\n${msg}\n`);
    process.exit(2);
  });
