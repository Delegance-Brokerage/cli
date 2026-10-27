/**
 * `delegance terms`: read the Delegance Terms of Service, and accept the
 * current version for your account.
 *
 *   terms          show the version, the links, and the summaries
 *   terms accept   accept the current version (a bind can require it)
 *
 * The acceptance step here and in `delegance signup` share `termsLines` and
 * `confirmTerms`, so the terminal user always sees the self-directed placement
 * disclosure (Terms Section 9A) before accepting.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import { createSignup, type TermsInfo } from '@delegance/sdk';
import { getBaseUrl } from '../utils/config';
import { CLI_CLIENT_HEADERS } from '../version';
import { getClient, failWith } from '../utils/client';
import { error, info, json, success, warn } from '../utils/output';
import { cliCommand } from '../utils/invocation';

/**
 * Why `terms accept` stopped. With no prompt shown (no terminal, or --json),
 * nobody declined, so the message names --yes. Exported for tests.
 */
export function termsAcceptRefusal(prompted: boolean): { kind: 'error' | 'warn'; message: string } {
  if (!prompted) {
    return { kind: 'error', message: `No prompt to answer. Read the Terms, then run "${cliCommand('terms accept --yes')}".` };
  }
  return { kind: 'warn', message: 'Not accepted. You can still quote; binding needs the current Terms.' };
}

/** What the user reads before accepting. Exported for tests. */
export function termsLines(t: TermsInfo): string[] {
  return [
    `Delegance Terms of Service (version ${t.version}): ${t.termsUrl}`,
    `Privacy Policy: ${t.privacyUrl}`,
    ...t.summaries,
  ];
}

/**
 * Ask for acceptance. `--accept-terms` (or `--yes`) counts as acceptance only
 * after the lines are printed. Without a terminal and without the flag there is
 * no one to ask, so the answer is no. Exported for tests.
 */
export async function confirmTerms(
  t: TermsInfo,
  opts: { flag: boolean; interactive: boolean; ask?: () => Promise<boolean>; print?: (line: string) => void },
): Promise<boolean> {
  termsLines(t).forEach((l) => (opts.print ?? info)(l));
  if (opts.flag) return true;
  if (!opts.interactive) return false;
  const ask = opts.ask ?? (async () => {
    const a = await inquirer.prompt([{
      type: 'confirm',
      name: 'ok',
      message: 'Do you accept the Terms of Service and Privacy Policy?',
      default: false,
    }]);
    return a.ok === true;
  });
  return ask();
}

export function createTermsCommand(): Command {
  const cmd = new Command('terms')
    .description('Show the Delegance Terms of Service, or accept the current version')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const t = await createSignup({ baseUrl: getBaseUrl(), headers: CLI_CLIENT_HEADERS }).getTerms();
        if (options.json) {
          json(t);
          return;
        }
        termsLines(t).forEach((l) => info(l));
        info(`Broker review before you bind: ${t.brokerReview.command}, or email ${t.brokerReview.email}`);
      } catch (err) {
        failWith('Could not load the Terms', err);
      }
    });

  cmd.command('accept')
    .description('Accept the current Terms of Service for your account (a bind can require it)')
    .option('-y, --yes', 'Accept without the prompt (you have read the Terms)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      try {
        const t = await client.terms.get();
        const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !options.json;
        const ok = await confirmTerms(t, {
          flag: options.yes === true,
          interactive,
          // --json keeps stdout to one JSON document; the Terms still print, on stderr.
          ...(options.json ? { print: (l: string) => console.error(l) } : {}),
        });
        if (!ok) {
          const refusal = termsAcceptRefusal(interactive);
          if (refusal.kind === 'error') error(refusal.message);
          else warn(refusal.message);
          process.exit(1);
        }
        const r = await client.terms.accept(t.version);
        if (options.json) {
          json(r);
          return;
        }
        success(`Accepted the Terms of Service, version ${r.version}.`);
      } catch (err) {
        failWith('Could not record your acceptance', err);
      }
    });

  return cmd;
}
