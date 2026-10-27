#!/usr/bin/env node
/**
 * Delegance CLI
 *
 * Command-line interface for the Delegance Brokerage platform.
 *
 * Usage:
 *   delegance auth login          # Authenticate with API key
 *   delegance company list        # List companies
 *   delegance doc upload file.pdf # Upload a document
 *   delegance appetite match ...  # Which carriers will write a risk
 */

import chalk from 'chalk';
import { createProgram } from '../program';
import { installLastCommandRecorder } from '../utils/last-command';
import { cliInvocation } from '../utils/invocation';
import { reportUncaughtError } from '../support';

// An error no command caught gets the support line, not a bare stack trace.
const onUncaught = (err: unknown) => process.exit(reportUncaughtError(err));
process.on('uncaughtException', onUncaught);
process.on('unhandledRejection', onUncaught);

const program = createProgram();
// Remembers the last command (name, exit code, trace id) for `delegance feedback --include-last`.
installLastCommandRecorder(program);

// Handle unknown commands
program.on('command:*', () => {
  console.error(chalk.red(`Unknown command: ${program.args.join(' ')}`));
  console.log();
  console.log(`Run "${cliInvocation()} --help" for a list of available commands.`);
  process.exit(1);
});

// Show help if no command provided
if (process.argv.length === 2) {
  program.outputHelp();
}

program.parse(process.argv);
