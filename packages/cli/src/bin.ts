#!/usr/bin/env node
// `aegis` — operator CLI entry point.
//
// Global flags (parsed from process.argv before commander dispatches):
//   --output json|table    set the process-wide output mode (defaults table)
//   --json                 sugar for `--output json`
//
// Exit codes are categorical per `exit-codes.ts` so scripts can switch
// without parsing stderr. AEGIS errors → 4–13; CLI errors → 20; verify
// DENY → 22; commander usage → 2; everything else → 1.

import { Command } from 'commander';

import { exitCodeFor, formatError } from './exit-codes.js';
import { err } from './output.js';
import { setOutputMode, type OutputMode } from './output.js';

import {
  bootstrap, whoami,
  agentsCreate, agentsList, agentsGet, agentsRevoke,
  policiesCreate, policiesList, policiesRevoke,
  auditSearch, auditVerify,
  kmsList, kmsRotate,
  mcpInstall,
  verify,
} from './index.js';

function applyGlobalFlags(argv: string[]): string[] {
  // Strip --output / --json before commander sees them so they're not
  // re-parsed by each subcommand. Idempotent if the user passes both.
  let mode: OutputMode = 'table';
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--json') {
      mode = 'json';
      continue;
    }
    if (a === '--output' && i + 1 < argv.length) {
      const next = argv[i + 1]!;
      if (next === 'json' || next === 'table') {
        mode = next;
        i += 1;
        continue;
      }
    }
    if (a.startsWith('--output=')) {
      const value = a.slice('--output='.length);
      if (value === 'json' || value === 'table') {
        mode = value;
        continue;
      }
    }
    out.push(a);
  }
  setOutputMode(mode);
  return out;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('aegis')
    .version('0.1.0')
    .description('AEGIS operator CLI')
    .helpOption('-h, --help', 'show help')
    .addHelpText(
      'after',
      [
        '',
        'Global flags (apply to every command):',
        '  --output json|table   structured JSON or human table output',
        '  --json                shorthand for --output=json',
        '',
        'Exit codes:',
        '  0   success',
        '  4   authentication error (missing/invalid API key)',
        '  5   authorization error',
        '  6   not found',
        '  7   rate limited (back off)',
        '  8   validation error (bad input)',
        '  9   conflict (e.g. already rotated)',
        '  11  network error',
        '  12  internal server error',
        '  13  service unavailable',
        '  20  CLI error (config/file/local)',
        '  22  verify returned DENIED (not an exception)',
      ].join('\n'),
    );

  program
    .command('bootstrap')
    .description('Configure AEGIS credentials at ~/.aegis/credentials.json')
    .option('--api-key <key>', 'AEGIS API key')
    .option('--base-url <url>', 'AEGIS API base URL', 'https://api.aegis.dev')
    .option('--force', 'overwrite existing credentials')
    .action(bootstrap);

  program.command('whoami').description('Show current credentials context').action(whoami);

  const agents = program.command('agents').description('Manage agents');
  agents
    .command('create')
    .requiredOption('-n, --name <name>', 'agent name')
    .option('-r, --runtime <runtime>', 'agent runtime (OPENAI/ANTHROPIC/...)', 'CUSTOM')
    .option('--print-private-key', 'print the generated private key (one-time)', false)
    .action(agentsCreate);
  agents
    .command('list')
    .option('--limit <n>', 'page size', (v) => Number.parseInt(v, 10))
    .option('--cursor <c>', 'pagination cursor')
    .option('--status <s>', 'PENDING_VERIFICATION | ACTIVE | SUSPENDED | REVOKED')
    .option('--runtime <r>', 'OPENAI | ANTHROPIC | GOOGLE | HUGGINGFACE | CUSTOM')
    .option('--search <q>', 'substring match on agentId/label/model')
    .option('--json', 'emit JSON (shorthand for --output=json)')
    .action(agentsList);
  agents.command('get').argument('<id>').option('--json').action(agentsGet);
  agents
    .command('revoke')
    .argument('<id>')
    .option('--reason <r>', 'reason recorded in audit log')
    .action(agentsRevoke);

  const policies = program.command('policies').description('Manage agent policies');
  policies
    .command('create')
    .requiredOption('-a, --agent-id <id>', 'agent id')
    .requiredOption('-s, --scopes-file <path>', 'JSON file with scope array')
    .option('--ttl <seconds>', 'policy TTL in seconds', (v) => Number.parseInt(v, 10), 86400)
    .option('--json')
    .action(policiesCreate);
  policies
    .command('list')
    .option('-a, --agent-id <id>', 'filter by agent')
    .option('-s, --status <status>', 'ACTIVE | REVOKED | EXPIRED')
    .option('--json')
    .action(policiesList);
  policies
    .command('revoke')
    .argument('<policyId>')
    .requiredOption('-a, --agent-id <id>', 'agent id (revoke endpoint is per-agent)')
    .option('--reason <r>', 'free-form reason (not yet persisted by SDK)')
    .action(policiesRevoke);

  program
    .command('verify')
    .description('Verify an AEGIS agent token (calls POST /v1/verify)')
    .argument('<token>', 'AEGIS-issued compact JWT')
    .option('--action <a>', 'action being attempted, e.g. "commerce.purchase"')
    .option('--amount <n>', 'requested amount', (v) => Number.parseFloat(v))
    .option('--currency <c>', 'ISO 4217 currency')
    .option('--merchant-domain <d>', 'merchant domain for scope match')
    .option('--merchant-id <id>', 'merchant id')
    .action(verify);

  const audit = program.command('audit').description('Audit log');
  audit
    .command('search')
    .option('-a, --agent-id <id>')
    .option('--from <iso>')
    .option('--to <iso>')
    .option('-d, --decision <d>', 'APPROVED | DENIED | FLAGGED')
    .option('--limit <n>', 'page size', (v) => Number.parseInt(v, 10), 50)
    .option('--json')
    .action(auditSearch);
  audit
    .command('verify')
    .description('Independently verify the audit chain against the published JWKS')
    .option('--from <iso>')
    .option('--to <iso>')
    .action(auditVerify);

  const kms = program.command('kms').description('Key management');
  kms
    .command('list')
    .option('-p, --purpose <p>', 'AUDIT | JWT | WEBHOOK')
    .action(kmsList);
  kms
    .command('rotate')
    .argument('<purpose>', 'AUDIT | JWT | WEBHOOK')
    .description('Print the rotation runbook (rotation itself happens in the cloud KMS console)')
    .action(kmsRotate);

  const mcp = program.command('mcp').description('Manage MCP host integration');
  mcp
    .command('install')
    .description('Add an aegis-mcp entry to your MCP host config')
    .option('--host <host>', 'claude-desktop | cursor', 'claude-desktop')
    .option('--server-name <name>', 'name to register the server under', 'aegis')
    .option('--force', 'overwrite an existing entry')
    .action(mcpInstall);

  const stripped = applyGlobalFlags(process.argv.slice(2));
  await program.parseAsync(stripped, { from: 'user' });
}

main().catch((e: unknown) => {
  err(formatError(e));
  process.exit(exitCodeFor(e));
});
