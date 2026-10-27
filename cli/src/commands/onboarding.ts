/**
 * Onboarding commands for the Delegance CLI
 *
 * Read the account's setup checklist and onboarding state, send the email
 * verification challenge, and wait for a target state.
 */

import { Command } from 'commander';
import ora from 'ora';
import type { OnboardingState } from '@delegance/sdk';
import { getClient, failWith, positiveInt } from '../utils/client';
import { error, info, json, header, keyValue } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

export const ONBOARDING_STATES: readonly OnboardingState[] = [
  'created',
  'awaiting_verification',
  'documents_pending',
  'processing',
  'ready',
];

export function createOnboardingCommand(): Command {
  const onboarding = new Command('onboarding')
    .alias('onboard')
    .description('Check account setup and onboarding state');

  onboarding
    .command('status')
    .description('Show the setup checklist and the next step')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching onboarding status...').start();
      try {
        const status = await client.onboarding.status();
        spinner.stop();
        if (options.json) {
          json(status);
          return;
        }
        header('Onboarding');
        keyValue({
          'Account': status.account,
          'Company profile': status.company,
          'Full profile': status.companyFull,
          'Billing': status.billing,
          'Quote ready': status.quoteReady,
          'Sandbox': status.sandbox
        });
        if (status.nextStep) {
          console.log();
          info(`Next step: ${status.nextStep.action}`);
          if (status.nextStep.fields?.length) info(`Missing: ${status.nextStep.fields.join(', ')}`);
          if (status.nextStep.url) info(status.nextStep.url);
        }
      } catch (err) {
        spinner.fail('Failed to fetch onboarding status');
        failWith('API error', err);
      }
    });

  onboarding
    .command('state')
    .description('Show the onboarding state machine position')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching onboarding state...').start();
      try {
        const state = await client.onboarding.state();
        spinner.stop();
        if (options.json) {
          json(state);
          return;
        }
        header('Onboarding state');
        keyValue({
          'State': state.state,
          'Verified': state.verified,
          'Verification sent to': state.verification.sentTo,
          'Documents': `${state.documents.processed}/${state.documents.total} processed`,
          'Capabilities': state.capabilities
        });
      } catch (err) {
        spinner.fail('Failed to fetch onboarding state');
        failWith('API error', err);
      }
    });

  onboarding
    .command('verify')
    .description('Email the account contact a verification link')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Requesting verification...').start();
      try {
        const result = await client.onboarding.requestVerification();
        spinner.succeed(`Verification sent to ${result.sentTo}`);
        if (options.json) json(result);
        else info(`Open the link in that email, then check progress with "${cliInvocation()} onboarding state"`);
      } catch (err) {
        spinner.fail('Failed to request verification');
        failWith('API error', err);
      }
    });

  onboarding
    .command('wait <state>')
    .description(`Wait until onboarding reaches a state (${ONBOARDING_STATES.join(', ')})`)
    .option('--timeout <ms>', 'Timeout in milliseconds', '600000')
    .option('--interval <ms>', 'Poll interval in milliseconds', '5000')
    .option('--json', 'Output as JSON')
    .action(async (target: string, options) => {
      if (!(ONBOARDING_STATES as readonly string[]).includes(target)) {
        error(`Unknown state "${target}"`);
        info(`Use one of: ${ONBOARDING_STATES.join(', ')}`);
        process.exit(1);
      }
      const client = getClient();
      const spinner = ora(`Waiting for ${target}...`).start();
      try {
        const state = await client.onboarding.waitForState(target as OnboardingState, {
          timeoutMs: positiveInt(options.timeout, '--timeout'),
          intervalMs: positiveInt(options.interval, '--interval')
        });
        spinner.succeed(`Onboarding reached ${state.state}`);
        if (options.json) json(state);
      } catch (err) {
        spinner.fail(`Did not reach ${target}`);
        failWith('Wait failed', err);
      }
    });

  return onboarding;
}
