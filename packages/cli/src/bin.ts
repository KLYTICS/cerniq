#!/usr/bin/env node
// `okoro` — operator CLI entry point.

import { Command } from 'commander';

import { CliError } from './client.js';
import { err } from './output.js';

import {
  bootstrap, whoami,
  agentsCreate, agentsList, agentsGet, agentsRevoke,
  policiesCreate, policiesList, policiesRevoke,
  auditSearch, auditVerify,
  kmsList, kmsRotate,
  mcpInstall,
} from './index.js';

async function main(): Promise<void> {
  const program = new Command();
  program.name('okoro').version('0.1.0').description('OKORO operator CLI');

  program
    .command('bootstrap')
    .description('Configure OKORO credentials at ~/.okoro/credentials.json')
    .option('--api-key <key>', 'OKORO API key')
    .option('--base-url <url>', 'OKORO API base URL', 'https://api.okoro.dev')
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
    .option('--json', 'emit JSON')
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
    .argument('<id>')
    .option('--reason <r>')
    .action(policiesRevoke);

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
    .description('Add an okoro-mcp entry to your MCP host config')
    .option('--host <host>', 'claude-desktop | cursor', 'claude-desktop')
    .option('--server-name <name>', 'name to register the server under', 'okoro')
    .option('--force', 'overwrite an existing entry')
    .action(mcpInstall);

  await program.parseAsync(process.argv);
}

main().catch((e: unknown) => {
  if (e instanceof CliError) {
    err(`${e.code}: ${e.message}`);
  } else {
    err((e as Error).message);
  }
  process.exit(1);
});
