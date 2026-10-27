/**
 * delegance feedback [message]   (alias: delegance bug)
 *
 * Sends a bug report, an idea, or a question to Delegance. With no message
 * and a terminal, it asks for one; with no terminal it exits 2 instead of
 * waiting on input that will never come. --include-last attaches the last
 * command's name, exit code, trace id, and the CLI and SDK versions, never
 * its arguments.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { SDK_VERSION, type FeedbackContext, type FeedbackType } from '@delegance/sdk';
import { CLI_VERSION } from '../version';
import { failWith, getClient } from '../utils/client';
import { error, info, json, success } from '../utils/output';
import { readLastCommand, type LastCommand } from '../utils/last-command';
import { cliInvocation } from '../utils/invocation';

const TYPES: FeedbackType[] = ['bug', 'idea', 'question'];
const MESSAGE_MAX = 500;
const USAGE = `${cliInvocation()} feedback "what happened" [--type bug|idea|question] [--include-last]`;

export function feedbackInputMode(o: { message: string | undefined; isTTY: boolean }): 'given' | 'prompt' | 'usage_error' {
  if (o.message && o.message.trim()) return 'given';
  return o.isTTY ? 'prompt' : 'usage_error';
}

/** Context for --include-last: the recorded fields plus versions, nothing else. */
export function buildFeedbackContext(last: LastCommand | null): FeedbackContext {
  const ctx: FeedbackContext = {};
  if (last) {
    ctx.command = last.command;
    ctx.exitCode = last.exitCode;
    if (last.traceId) ctx.traceId = last.traceId;
    ctx.at = last.at;
  }
  ctx.cliVersion = CLI_VERSION;
  ctx.sdkVersion = SDK_VERSION;
  return ctx;
}

function usageError(message: string): never {
  error(message);
  info(`Usage: ${USAGE}`);
  process.exit(2);
}

export function createFeedbackCommand(): Command {
  return new Command('feedback')
    .alias('bug')
    .description('Report a bug, an idea, or a question to Delegance')
    .argument('[message...]', 'What happened (asked for when left out on a terminal)')
    .option('-t, --type <type>', 'bug, idea, or question', 'bug')
    .option('--include-last', 'Attach the last command name, exit code, trace id, and CLI/SDK versions (never its arguments)')
    .option('--json', 'Output as JSON')
    .action(async (words: string[], options: { type: string; includeLast?: boolean; json?: boolean }) => {
      const type = String(options.type ?? 'bug').toLowerCase() as FeedbackType;
      if (!TYPES.includes(type)) usageError(`--type must be bug, idea, or question, got "${options.type}"`);

      let message = (words ?? []).join(' ').trim();
      const mode = feedbackInputMode({ message, isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY) });
      if (mode === 'usage_error') usageError(`Say what happened: ${USAGE}`);
      if (mode === 'prompt') {
        const answer = await inquirer.prompt([
          { type: 'input', name: 'message', message: type === 'bug' ? 'What went wrong?' : 'What would you like to tell us?' },
        ] as never);
        message = String((answer as { message?: string }).message ?? '').trim();
        if (!message) usageError('Nothing sent: the message was empty.');
      }
      if (message.length > MESSAGE_MAX) usageError(`Keep the message to ${MESSAGE_MAX} characters or fewer (it has ${message.length}).`);

      const context = options.includeLast ? buildFeedbackContext(readLastCommand()) : undefined;
      try {
        const { id } = await getClient().feedback.submit({ type, message, context });
        if (options.json) {
          json({ id });
          return;
        }
        success(`Sent. Reference: ${id}`);
      } catch (err) {
        failWith('Could not send the report', err);
      }
    });
}
