/**
 * Builds the `delegance` command tree. The bin entry parses argv against it;
 * tests inspect it without running any command.
 */

import { Command } from 'commander';
import { CLI_VERSION } from './version';
import { supportLine } from './support';
import { createAuthCommand } from './commands/auth';
import { createCompanyCommand } from './commands/company';
import { createDocumentCommand } from './commands/document';
import { createChatCommand } from './commands/chat';
import { createQuoteCommand } from './commands/quote';
import { createPolicyCommand } from './commands/policy';
import { createCOICommand } from './commands/coi';
import { createSOVCommand } from './commands/sov';
import { createAppetiteCommand } from './commands/appetite';
import { createLeadCommand } from './commands/lead';
import { createKnowledgeCommand } from './commands/knowledge';
import { createOnboardingCommand } from './commands/onboarding';
import { createUsageCommand } from './commands/usage';
import { createKeysCommand } from './commands/keys';
import { createConfigCommand } from './commands/config';
import { createSignupCommand, createVerifyCommand } from './commands/signup';
import { createFeedbackCommand } from './commands/feedback';
import { migrateLegacyConfigKey } from './utils/config';
import { createTermsCommand } from './commands/terms';
import { registerMinimalCheckbox } from './utils/checkbox-prompt';
import { createBillingCommand, createBindCommand, createPayCommand, createBondCommand, createClaimCommand } from './commands/commerce';

export function createProgram(): Command {
  registerMinimalCheckbox();
  const program = new Command();

  program
    .name('delegance')
    .description('CLI for the Delegance Brokerage platform')
    .version(CLI_VERSION)
    // Root options are read only BEFORE the subcommand. Without this the root
    // --json swallowed every subcommand's own --json flag.
    .enablePositionalOptions()
    .option('-v, --verbose', 'Enable verbose output')
    .option('--json', 'Output in JSON format')
    // Root help only: subcommand help stays about the subcommand.
    .addHelpText('after', () => `\n${supportLine()}`)
    // Before any command: move a key an older CLI left in plaintext
    // config.json into the 0600 credentials file (never prints the key).
    .hook('preAction', () => {
      migrateLegacyConfigKey();
    });

  program.addCommand(createSignupCommand());
  program.addCommand(createVerifyCommand());
  program.addCommand(createAuthCommand());
  program.addCommand(createCompanyCommand());
  program.addCommand(createDocumentCommand());
  program.addCommand(createChatCommand());
  program.addCommand(createQuoteCommand());
  program.addCommand(createPolicyCommand());
  program.addCommand(createCOICommand());
  program.addCommand(createSOVCommand());
  program.addCommand(createAppetiteCommand());
  program.addCommand(createLeadCommand());
  program.addCommand(createKnowledgeCommand());
  program.addCommand(createOnboardingCommand());
  program.addCommand(createUsageCommand());
  program.addCommand(createKeysCommand());
  program.addCommand(createBindCommand());
  program.addCommand(createPayCommand());
  program.addCommand(createBillingCommand());
  program.addCommand(createBondCommand());
  program.addCommand(createClaimCommand());
  program.addCommand(createFeedbackCommand());
  program.addCommand(createTermsCommand());
  program.addCommand(createConfigCommand());

  return program;
}
