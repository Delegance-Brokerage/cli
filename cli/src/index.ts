/**
 * Delegance CLI
 * 
 * This module exports the CLI commands for programmatic use.
 */

export { createAuthCommand } from './commands/auth';
export { createCompanyCommand } from './commands/company';
export { createDocumentCommand } from './commands/document';
export { createChatCommand } from './commands/chat';
export { createQuoteCommand } from './commands/quote';
export { createPolicyCommand } from './commands/policy';
export { createCOICommand } from './commands/coi';
export { createSOVCommand } from './commands/sov';
export { createAppetiteCommand } from './commands/appetite';
export { createLeadCommand } from './commands/lead';
export { createKnowledgeCommand } from './commands/knowledge';
export { createOnboardingCommand } from './commands/onboarding';
export { createUsageCommand } from './commands/usage';
export { createKeysCommand } from './commands/keys';
export { createConfigCommand } from './commands/config';
export { createProgram } from './program';
export { CLI_VERSION } from './version';

export {
  getConfig,
  setConfig,
  getAllConfig,
  clearConfig,
  getConfigPath,
  storeApiKey,
  getApiKey,
  isAuthenticated,
  clearCredentials,
  getBaseUrl,
  maskApiKey
} from './utils/config';

export * as output from './utils/output';
