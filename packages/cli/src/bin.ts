#!/usr/bin/env node
// `cerniq` — operator CLI entry point.

import { Command } from 'commander';

import { CliError } from './client.js';
import { err } from './output.js';

import {
  bootstrap,
  whoami,
  agentsCreate,
  agentsList,
  agentsGet,
  agentsRevoke,
  policiesCreate,
  policiesList,
  policiesRevoke,
  auditSearch,
  auditVerify,
  kmsList,
  kmsRotate,
  mcpInstall,
} from './index.js';

async function main(): Promise<void> {
  const program = new Command();
  program.name('cerniq').version('0.1.0').description('CERNIQ operator CLI');

  program
    .command('bootstrap')
    .description('Configure CERNIQ credentials at ~/.cerniq/credentials.json')
    .option('--api-key <key>', 'CERNIQ API key')
    .option('--base-url <url>', 'CERNIQ API base URL', 'https://api.cerniq.dev')
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
    // `--reason` was a no-op (API DELETE /agents/:id takes no body). Removed
    // here so the CLI doesn't promise functionality that doesn't land. If you
    // need an auditable reason, file an API change first.
    .action((id: string) => agentsRevoke(id));

  const policies = program.command('policies').description('Manage agent policies');
  policies
    .command('create')
    .requiredOption('-a, --agent-id <id>', 'agent id')
    .requiredOption('-s, --scopes-file <path>', 'JSON file with scope array')
    .option('-l, --label <label>', 'human-readable policy label')
    .option('--ttl <seconds>', 'policy TTL in seconds', (v) => Number.parseInt(v, 10), 86400)
    .option('--json')
    .action(policiesCreate);
  policies
    .command('list')
    // agentId is now required (API endpoint is per-agent:
    // `GET /agents/:agentId/policies`). `--status` was an unsupported filter
    // (the API returns active policies; lifecycle events live in audit).
    .requiredOption('-a, --agent-id <id>', 'agent id whose policies to list')
    .option('--json')
    .action(policiesList);
  policies
    .command('revoke')
    .argument('<policyId>')
    // agentId is required because the API endpoint is
    // `DELETE /agents/:agentId/policies/:policyId`. `--reason` was a no-op
    // (not in API contract) and is dropped.
    .requiredOption('-a, --agent-id <id>', 'agent id that owns this policy')
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
  kms.command('list').option('-p, --purpose <p>', 'AUDIT | JWT | WEBHOOK').action(kmsList);
  kms
    .command('rotate')
    .argument('<purpose>', 'AUDIT | JWT | WEBHOOK')
    .description('Print the rotation runbook (rotation itself happens in the cloud KMS console)')
    .action(kmsRotate);

  const mcp = program.command('mcp').description('Manage MCP host integration');
  mcp
    .command('install')
    .description('Add an cerniq-mcp entry to your MCP host config')
    .option('--host <host>', 'claude-desktop | cursor', 'claude-desktop')
    .option('--server-name <name>', 'name to register the server under', 'cerniq')
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
