// Public surface of `@aegis/cli`. Most users invoke via the binary
// `aegis`; library users can import individual commands.

export { bootstrap } from './commands/bootstrap.js';
export { whoami } from './commands/whoami.js';
export {
  agentsCreate,
  agentsList,
  agentsGet,
  agentsRevoke,
} from './commands/agents.js';
export {
  policiesCreate,
  policiesList,
  policiesRevoke,
} from './commands/policies.js';
export { auditSearch, auditVerify } from './commands/audit.js';
export { kmsList, kmsRotate } from './commands/kms.js';
export { mcpInstall } from './commands/mcp.js';
export { verify, type VerifyOptions } from './commands/verify.js';
export { resolveCredentials, writeCredentials, type AegisCredentials } from './credentials.js';
export {
  exitCodeFor,
  formatError,
  EXIT_SUCCESS,
  EXIT_GENERIC,
  EXIT_AUTHN,
  EXIT_AUTHZ,
  EXIT_NOT_FOUND,
  EXIT_RATE_LIMITED,
  EXIT_VALIDATION,
  EXIT_CONFLICT,
  EXIT_NETWORK,
  EXIT_INTERNAL,
  EXIT_UNAVAILABLE,
  EXIT_CLI,
} from './exit-codes.js';
export { setOutputMode, getOutputMode, type OutputMode } from './output.js';
