/**
 * Appetite commands for the Delegance CLI
 *
 * Which carriers will write a risk. Needs an API key with the
 * `appetite:read` scope; `read` and `write` do not include it.
 */

import { Command } from 'commander';
import ora from 'ora';
import type { AppetiteMatchInput, AppetiteMatchResult } from '@delegance/sdk';
import { getClient, failWith, positiveInt } from '../utils/client';
import { error, info, warn, table, json } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Build the request body from CLI options. Exported for tests. */
export function buildMatchInput(options: Record<string, string | string[] | undefined>): AppetiteMatchInput {
  const list = (v: string | string[] | undefined): string[] | undefined => {
    if (v === undefined) return undefined;
    const parts = (Array.isArray(v) ? v : [v]).flatMap(p => p.split(',')).map(p => p.trim()).filter(Boolean);
    return parts.length ? parts : undefined;
  };
  return {
    state: String(options.state ?? '').toUpperCase(),
    industry: options.industry as string | undefined,
    businessDescription: options.description as string | undefined,
    naicsCode: options.naics as string | undefined,
    sicCode: options.sic as string | undefined,
    coverageTypes: list(options.coverage),
    carriers: list(options.carriers),
    marketSize: options.marketSize as AppetiteMatchInput['marketSize'],
    annualRevenue: num(options.revenue as string | undefined),
    annualPayroll: num(options.payroll as string | undefined),
    propertyValue: num(options.propertyValue as string | undefined),
    minFit: options.minFit as AppetiteMatchInput['minFit'],
    topK: num(options.top as string | undefined),
  };
}

function printResult(result: AppetiteMatchResult): void {
  if (result.carrierResults.length === 0) {
    warn('No carrier appetite found for this risk');
  } else {
    console.log();
    table(
      ['Carrier', 'Status', 'Confidence', 'Best class', 'Products'],
      result.carrierResults.map(c => [
        c.carrier,
        c.overallStatus,
        `${Math.round(c.confidence * 100)}%`,
        c.bestMatch?.classDescription ?? '-',
        c.productsAvailable.join(', ')
      ])
    );
  }
  for (const w of result.warnings) warn(w);
}

export function createAppetiteCommand(): Command {
  const appetite = new Command('appetite').description('Check which carriers will write a risk');

  appetite
    .command('match')
    .description('Match a business to carrier appetite')
    .requiredOption('-s, --state <state>', 'Two-letter state code')
    .option('-i, --industry <industry>', 'Industry, e.g. "bakery"')
    .option('-d, --description <text>', 'What the business does')
    .option('--naics <code>', 'NAICS code')
    .option('--sic <code>', 'SIC code')
    .option('-c, --coverage <types>', 'Comma-separated coverage types, e.g. general_liability,workers_comp')
    .option('--carriers <names>', 'Comma-separated carriers to limit the match to')
    .option('--market-size <size>', '"Small Business" or "Middle Market"')
    .option('--revenue <usd>', 'Annual revenue')
    .option('--payroll <usd>', 'Annual payroll')
    .option('--property-value <usd>', 'Total property value')
    .option('--min-fit <fit>', 'Raise the quality floor: possible or strong')
    .option('--top <n>', 'Maximum matches (1-50)')
    .option('--no-wait', 'Return the job id instead of waiting for a cold match')
    .option('--timeout <ms>', 'How long to wait for a cold match', '120000')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const input = buildMatchInput(options);
      const timeoutMs = positiveInt(options.timeout, '--timeout');
      if (!input.industry && !input.businessDescription && !input.naicsCode && !input.sicCode) {
        error('Describe the business');
        info('Pass one of --industry, --description, --naics, or --sic');
        process.exit(1);
      }

      const client = getClient();
      const spinner = ora('Matching appetite...').start();
      try {
        const start = await client.appetite.match(input);

        if (start.status === 'succeeded') {
          spinner.succeed('Match ready (cached)');
          if (options.json) json(start);
          else printResult(start);
          return;
        }

        if (!options.wait) {
          spinner.succeed(`Match queued: ${start.jobId}`);
          if (options.json) json(start);
          else info(`Check it with "${cliInvocation()} appetite status ${start.jobId}"`);
          return;
        }

        spinner.text = `Matching appetite (about ${start.estimatedSeconds}s)...`;
        const done = await client.appetite.waitForMatch(start.jobId, { timeoutMs });
        spinner.succeed('Match ready');
        if (options.json) json(done);
        else printResult(done);
      } catch (err) {
        spinner.fail('Appetite match failed');
        failWith('API error', err);
      }
    });

  appetite
    .command('status <jobId>')
    .description('Check a queued appetite match')
    .option('--json', 'Output as JSON')
    .action(async (jobId: string, options) => {
      const client = getClient();
      const spinner = ora('Fetching match...').start();
      try {
        const job = await client.appetite.getMatch(jobId);
        if (job.status === 'succeeded') {
          spinner.succeed('Match ready');
          if (options.json) json(job);
          else printResult(job);
        } else if (job.status === 'failed') {
          spinner.fail(`Match failed: ${job.errorCode}${job.retryable ? ' (retryable)' : ''}`);
          if (options.json) json(job);
          process.exit(1);
        } else {
          spinner.info(`Match ${job.status}`);
          if (options.json) json(job);
        }
      } catch (err) {
        spinner.fail('Failed to fetch match');
        failWith('API error', err);
      }
    });

  return appetite;
}
