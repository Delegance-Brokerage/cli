/**
 * Where a stuck CLI user goes for help. The one copy of the support address:
 * the root help footer, unexpected-error output, and the bind broker-review
 * path all read it from here.
 */

import { error } from './utils/output';
import { cliInvocation } from './utils/invocation';

export const SUPPORT_EMAIL = 'support@delegancebrokerage.com';

/** One line: `Need help? Email support@... or run "delegance feedback".` */
export function supportLine(): string {
  return `Need help? Email ${SUPPORT_EMAIL} or run "${cliInvocation()} feedback".`;
}

/** Ctrl+C inside an inquirer prompt rejects with one of these. */
export function isPromptExit(err: unknown): boolean {
  return err instanceof Error && (err.name === 'ExitPromptError' || /force closed/i.test(err.message));
}

/**
 * Last stop for an error no command caught. Prints the message and the
 * support line instead of a Node stack trace (the stack still prints with
 * DEBUG or VERBOSE set) and returns the exit code. Ctrl+C in a prompt exits
 * 130 with no message.
 */
export function reportUncaughtError(err: unknown, env: NodeJS.ProcessEnv = process.env): number {
  if (isPromptExit(err)) return 130;
  error('Unexpected error', err instanceof Error ? err.message : String(err));
  if ((env.DEBUG || env.VERBOSE) && err instanceof Error && err.stack) console.error(err.stack);
  console.error(supportLine());
  return 1;
}
