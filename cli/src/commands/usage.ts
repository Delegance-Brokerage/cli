/**
 * Usage commands for the Delegance CLI
 *
 * Billing-period summary, daily metered usage, and rate-limit headroom.
 */

import { Command } from 'commander';
import ora from 'ora';
import { getClient, failWith } from '../utils/client';
import { table, json, header, keyValue, formatDate } from '../utils/output';

/** YYYY-MM-DD for a date `daysAgo` days before `now` (UTC). */
export function isoDay(daysAgo: number, now: Date = new Date()): string {
  const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function cents(n: number): string {
  return `$${(n / 100).toFixed(2)}`;
}

export function createUsageCommand(): Command {
  const usage = new Command('usage').description('Show API usage, billing, and rate limits');

  usage
    .command('summary')
    .description('Usage for the current billing period')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching usage summary...').start();
      try {
        const s = await client.usage.summary();
        spinner.stop();
        if (options.json) {
          json(s);
          return;
        }
        header(`Usage for ${s.period}`);
        keyValue({
          'Plan': s.plan,
          'Status': s.status,
          'Overage': cents(s.totalOverageCents),
          'As of': formatDate(s.asOf)
        });
        const meters = Object.entries(s.meters);
        if (meters.length > 0) {
          console.log();
          table(
            ['Meter', 'Used', 'Included', 'Overage', 'Overage cost'],
            meters.map(([name, m]) => [name, m.used, m.included, m.overage, cents(m.overageCostCents)])
          );
        }
      } catch (err) {
        spinner.fail('Failed to fetch usage summary');
        failWith('API error', err);
      }
    });

  usage
    .command('daily')
    .description('Daily metered usage (default: the last 30 days)')
    .option('--from <date>', 'Start date, YYYY-MM-DD (inclusive)')
    .option('--to <date>', 'End date, YYYY-MM-DD (inclusive)')
    .option('-m, --meter <meter>', 'Only this meter')
    .option('-g, --group-by <group>', 'Aggregate by day or meter')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching daily usage...').start();
      try {
        const { data } = await client.usage.daily({
          from: options.from ?? isoDay(29),
          to: options.to ?? isoDay(0),
          meter: options.meter,
          groupBy: options.groupBy
        });
        spinner.succeed(`${data.length} rows`);
        if (options.json) {
          json(data);
          return;
        }
        if (data.length > 0) {
          console.log();
          table(['Date', 'Meter', 'Quantity'], data.map(r => [r.date, r.meter, r.quantity]));
        }
      } catch (err) {
        spinner.fail('Failed to fetch daily usage');
        failWith('API error', err);
      }
    });

  usage
    .command('limits')
    .alias('rate-limits')
    .description('Current rate-limit window')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching rate limits...').start();
      try {
        const r = await client.usage.rateLimits();
        spinner.stop();
        if (options.json) {
          json(r);
          return;
        }
        header('Rate limits');
        keyValue({
          'Per minute': r.requestsPerMinute,
          'Remaining': r.remaining,
          'Resets at': formatDate(r.resetsAt)
        });
      } catch (err) {
        spinner.fail('Failed to fetch rate limits');
        failWith('API error', err);
      }
    });

  return usage;
}
