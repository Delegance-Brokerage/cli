/**
 * Quote commands for the Delegance CLI
 * 
 * Request and manage insurance quotes.
 */

import { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import { NotImplementedError } from '@delegance/sdk';
import { getClient, failWith, PORTAL_URL } from '../utils/client';
import { addInstantQuoteCommands } from './instant-quote';
import { success, error, info, warn, table, json, header, keyValue, formatDate } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

export const QUOTE_SUBMISSION_UNAVAILABLE = "Quote submission via API isn't available yet";

export function createQuoteCommand(): Command {
  const quote = new Command('quote')
    .alias('quotes')
    .description('Request and manage insurance quotes');

  // List available carriers
  quote
    .command('carriers')
    .description('List available carriers for quoting')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching carriers...').start();

      try {
        const { carriers, count } = await client.quotes.listCarriers();

        spinner.succeed(`Found ${count} carriers`);

        if (carriers.length === 0) {
          info('No carriers available');
          return;
        }

        if (options.json) {
          json(carriers);
        } else {
          console.log();
          table(
            ['ID', 'Name', 'Avg Quote Time', 'Queue Depth'],
            carriers.map(c => [
              c.id,
              c.name,
              `${Math.round(c.averageQuoteTimeSeconds / 60)} min`,
              String(c.queueDepth)
            ])
          );
        }

      } catch (err) {
        spinner.fail('Failed to fetch carriers');
        failWith('API error', err);
      }
    });

  // Submit a quote request
  quote
    .command('request')
    .description('Legacy partner queue submission (not live). For an instant quote, use "quote start"')
    .option('-c, --carriers <carriers...>', 'Carrier IDs to quote (space-separated)')
    .option('-p, --priority <priority>', 'Priority level (low, normal, high)', 'normal')
    .option('--all', 'Request quotes from all available carriers')
    .option('-i, --interactive', 'Interactive carrier selection')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      let carrierIds: string[] = options.carriers || [];

      // Get available carriers first
      const carriersSpinner = ora('Fetching available carriers...').start();
      let availableCarriers: Awaited<ReturnType<typeof client.quotes.listCarriers>>['carriers'];
      try {
        ({ carriers: availableCarriers } = await client.quotes.listCarriers());
        carriersSpinner.stop();
      } catch (err) {
        carriersSpinner.fail('Failed to fetch carriers');
        failWith('API error', err);
      }

      if (availableCarriers.length === 0) {
        error('No carriers available for quoting');
        process.exit(1);
      }

      // Interactive mode
      if (options.interactive || (carrierIds.length === 0 && !options.all)) {
        const { selectedCarriers } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedCarriers',
            message: 'Select carriers to quote:',
            choices: availableCarriers.map(c => ({
              name: `${c.name} (avg ${Math.round(c.averageQuoteTimeSeconds / 60)} min)`,
              value: c.id,
              checked: false
            })),
            validate: (input: string[]) => input.length > 0 || 'Select at least one carrier'
          }
        ]);
        carrierIds = selectedCarriers;
      } else if (options.all) {
        carrierIds = availableCarriers.map(c => c.id);
        info(`Requesting quotes from all ${carrierIds.length} carriers`);
      }

      if (carrierIds.length === 0) {
        error('No carriers specified');
        info('Use --carriers, --all, or --interactive to select carriers');
        process.exit(1);
      }

      // Submit the quote request
      const spinner = ora(`Submitting quote request to ${carrierIds.length} carriers...`).start();

      try {
        const result = await client.quotes.submit({
          carriers: carrierIds,
          priority: options.priority as 'low' | 'normal' | 'high'
        });

        if (result.success) {
          spinner.succeed(result.message);
        } else {
          spinner.warn(result.message);
        }

        if (options.json) {
          json(result);
        } else {
          console.log();
          
          if (result.carriers && result.carriers.length > 0) {
            info('Queued for:');
            for (const carrier of result.carriers) {
              console.log(`  - ${carrier.name}`);
            }
          }

          if (result.invalidCarriers && result.invalidCarriers.length > 0) {
            console.log();
            warn(`Invalid carriers: ${result.invalidCarriers.join(', ')}`);
          }

          if (result.errors && result.errors.length > 0) {
            console.log();
            for (const err of result.errors) {
              error(err);
            }
          }

          console.log();
          info(`Queue IDs: ${result.queueIds.join(', ')}`);
          info(`Use "${cliInvocation()} quote list" to check status`);
        }

      } catch (err) {
        spinner.fail('Failed to submit quote request');
        if (err instanceof NotImplementedError) {
          error(QUOTE_SUBMISSION_UNAVAILABLE);
          info(`For an instant quote from the terminal: ${cliInvocation()} quote start --coverage gl`);
          info(`Or start a quote at ${PORTAL_URL}`);
          process.exit(1);
        }
        failWith('API error', err);
      }
    });

  // List quotes
  quote
    .command('list')
    .alias('ls')
    .description('List quote requests')
    .option('-s, --status <status>', 'Filter by status (pending, processing, completed, failed)')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching quotes...').start();

      try {
        const { quotes, count } = await client.quotes.list({
          status: options.status,
          limit: parseInt(options.limit)
        });

        spinner.succeed(`Found ${count} quotes`);

        if (quotes.length === 0) {
          info('No quotes found');
          return;
        }

        if (options.json) {
          json(quotes);
        } else {
          console.log();
          table(
            ['ID', 'Carrier', 'Status', 'Priority', 'Created'],
            quotes.map(q => [
              `${q.id.substring(0, 8)}...`,
              q.carrierName,
              formatQuoteStatus(q),
              q.priority,
              formatDate(q.createdAt)
            ])
          );
        }

      } catch (err) {
        spinner.fail('Failed to list quotes');
        failWith('API error', err);
      }
    });

  // Wait for quotes to complete
  quote
    .command('wait <quoteIds...>')
    .description('Wait for quote(s) to complete')
    .option('--timeout <ms>', 'Timeout in milliseconds', '300000')
    .option('--json', 'Output as JSON')
    .action(async (quoteIds: string[], options) => {
      const client = getClient();
      const timeoutMs = parseInt(options.timeout);

      info(`Waiting for ${quoteIds.length} quote(s) to complete...`);
      console.log();

      const results: { id: string; status: string; error?: string }[] = [];

      for (const quoteId of quoteIds) {
        const spinner = ora(`Waiting for ${quoteId.substring(0, 8)}...`).start();

        try {
          const quote = await client.quotes.waitForCompletion(quoteId, { timeoutMs });

          if (quote.status === 'completed') {
            spinner.succeed(`${quote.carrierName}: Completed`);
            if (quote.result?.premium) {
              info(`  Premium: $${quote.result.premium.toLocaleString()}`);
            }
          } else if (quote.outcome === 'referred' || quote.outcome === 'needs_info') {
            spinner.info(`${quote.carrierName}: ${formatQuoteStatus(quote).slice(2)}. Delegance follows up with you.`);
          } else if (quote.outcome === 'declined') {
            spinner.warn(`${quote.carrierName}: Declined${quote.error ? ` - ${quote.error}` : ''}`);
          } else if (quote.status === 'failed') {
            spinner.fail(`${quote.carrierName}: Failed - ${quote.error || 'Unknown error'}`);
          } else {
            spinner.warn(`${quote.carrierName}: ${quote.status}`);
          }

          results.push({ id: quoteId, status: quote.status, error: quote.error });

        } catch (err) {
          spinner.fail(`${quoteId.substring(0, 8)}: ${(err as Error).message}`);
          results.push({ id: quoteId, status: 'error', error: (err as Error).message });
        }
      }

      if (options.json) {
        json(results);
      }
    });

  // Get a single quote
  quote
    .command('get <quoteId>')
    .description('Show one quote request')
    .option('--json', 'Output as JSON')
    .action(async (quoteId: string, options) => {
      const client = getClient();
      const spinner = ora('Fetching quote...').start();

      try {
        const { quote: q, canCancel } = await client.quotes.get(quoteId);
        spinner.succeed('Quote found');

        if (options.json) {
          json({ quote: q, canCancel });
          return;
        }

        console.log();
        header(`${q.carrierName} quote`);
        keyValue({
          'ID': q.id,
          'Status': formatQuoteStatus(q),
          'Priority': q.priority,
          'Created': formatDate(q.createdAt),
          'Completed': q.completedAt ? formatDate(q.completedAt) : null,
          'Premium': q.result?.premium ?? null,
          'Bindable': q.result?.bindable ?? null,
          'Error': q.error ?? null,
          'Can cancel': canCancel
        });
      } catch (err) {
        spinner.fail('Failed to fetch quote');
        failWith('API error', err);
      }
    });

  // Cancel a pending quote
  quote
    .command('cancel <quoteId>')
    .description('Cancel a pending quote request')
    .option('--json', 'Output as JSON')
    .action(async (quoteId: string, options) => {
      const client = getClient();
      const spinner = ora('Cancelling quote...').start();

      try {
        const result = await client.quotes.cancel(quoteId);
        spinner.succeed(result.message || 'Quote cancelled');
        if (options.json) json(result);
      } catch (err) {
        spinner.fail('Failed to cancel quote');
        failWith('API error', err);
      }
    });

  addInstantQuoteCommands(quote);

  return quote;
}

/**
 * One quote's status cell. An instant quote's `outcome` (newer servers) wins
 * where the five-value status cannot say it: a referral stays `processing`
 * because an underwriter may still price it, but the carrier has answered.
 * Exported for tests.
 */
export function formatQuoteStatus(q: { status: string; outcome?: string | null }): string {
  switch (q.outcome) {
    case 'referred':
      return '↗ referred to an underwriter';
    case 'needs_info':
      return '! needs more information';
    case 'declined':
      return '✗ declined';
    default:
      break;
  }
  const { status } = q;
  switch (status) {
    case 'completed':
      return '✓ completed';
    case 'pending':
      return '○ pending';
    case 'processing':
      return '◐ processing';
    case 'failed':
      return '✗ failed';
    case 'cancelled':
      return '⊘ cancelled';
    default:
      return status;
  }
}
