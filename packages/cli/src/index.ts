// Public surface of `@cerniq/cli`. Most users invoke via the binary
// `cerniq`; library users can import individual commands.

export { bootstrap } from './commands/bootstrap.js';
export { whoami } from './commands/whoami.js';
export { agentsCreate, agentsList, agentsGet, agentsRevoke } from './commands/agents.js';
export { policiesCreate, policiesList, policiesRevoke } from './commands/policies.js';
export { auditSearch, auditVerify } from './commands/audit.js';
export { kmsList, kmsRotate } from './commands/kms.js';
export { mcpInstall } from './commands/mcp.js';
export { resolveCredentials, writeCredentials, type CerniqCredentials } from './credentials.js';
