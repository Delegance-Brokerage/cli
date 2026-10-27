/**
 * SOV commands for the Delegance CLI
 * 
 * Manage Schedules of Values for commercial property insurance.
 */

import { Command } from 'commander';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { getClient, failWith } from '../utils/client';
import { success, error, info, warn, table, json, header, formatDate, formatCurrency } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

export function createSOVCommand(): Command {
  const sov = new Command('sov')
    .description('Manage Schedules of Values (property schedules)');

  // Upload SOV
  sov
    .command('upload <file>')
    .description('Upload a Schedule of Values file')
    .option('-l, --line <line>', 'Line of business (property, inland_marine, etc)', 'property')
    .option('--effective <date>', 'Effective date (YYYY-MM-DD)')
    .option('--expiration <date>', 'Expiration date (YYYY-MM-DD)')
    .option('-w, --wait', 'Wait for parsing to complete')
    .option('--json', 'Output as JSON')
    .action(async (file: string, options) => {
      const client = getClient();
      
      // Resolve file path
      const filePath = path.resolve(file);
      
      if (!fs.existsSync(filePath)) {
        error(`File not found: ${file}`);
        process.exit(1);
      }

      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).toLowerCase();
      
      if (!['.xlsx', '.xls', '.csv', '.pdf'].includes(ext)) {
        error('Unsupported file type. Supported: .xlsx, .xls, .csv, .pdf');
        process.exit(1);
      }

      const spinner = ora(`Uploading ${fileName}...`).start();

      try {
        const fileBuffer = fs.readFileSync(filePath);
        
        const result = await client.sov.upload({
          file: fileBuffer,
          fileName,
          lineOfBusiness: options.line,
          effectiveDate: options.effective,
          expirationDate: options.expiration
        });

        spinner.succeed(`SOV uploaded: ${result.sovId}`);

        if (options.wait) {
          const parseSpinner = ora('Waiting for parsing...').start();
          
          try {
            const parsed = await client.sov.waitForParsing(result.sovId);
            
            if (parsed.status === 'error') {
              parseSpinner.fail('Parsing failed');
            } else {
              parseSpinner.succeed(`Parsing complete - ${parsed.totalLocations || 0} locations, TIV: ${formatCurrency(parsed.totalTIV || 0)}`);
            }
          } catch (waitErr) {
            parseSpinner.fail((waitErr as Error).message);
          }
        }

        if (options.json) {
          json(result);
        } else {
          console.log();
          info(`SOV ID: ${result.sovId}`);
          info(`Status: ${result.status}`);
          if (!options.wait) {
            info(`Use "${cliInvocation()} sov status <id>" to check parsing progress`);
          }
        }

      } catch (err) {
        spinner.fail('Failed to upload SOV');
        failWith('API error', err);
      }
    });

  // List SOVs
  sov
    .command('list')
    .alias('ls')
    .description('List uploaded SOVs')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching SOVs...').start();

      try {
        const { sovs, count } = await client.sov.list({
          status: options.status,
          limit: parseInt(options.limit)
        });

        spinner.succeed(`Found ${count} SOVs`);

        if (sovs.length === 0) {
          info('No SOVs found');
          info(`Upload one with "${cliInvocation()} sov upload schedule.xlsx"`);
          return;
        }

        if (options.json) {
          json(sovs);
        } else {
          console.log();
          table(
            ['ID', 'File Name', 'Status', 'Locations', 'Total TIV', 'Created'],
            sovs.map(s => [
              `${s.id.substring(0, 8)}...`,
              s.fileName.substring(0, 25) + (s.fileName.length > 25 ? '...' : ''),
              formatSOVStatus(s.status),
              s.totalLocations?.toString() || '-',
              s.totalTIV ? formatCurrency(s.totalTIV) : '-',
              formatDate(s.createdAt)
            ])
          );
        }

      } catch (err) {
        spinner.fail('Failed to fetch SOVs');
        failWith('API error', err);
      }
    });

  // Check SOV status
  sov
    .command('status <id>')
    .description('Check SOV status')
    .option('-w, --wait', 'Wait for parsing to complete')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const client = getClient();
      
      if (options.wait) {
        const spinner = ora('Waiting for SOV processing...').start();
        
        try {
          const s = await client.sov.waitForParsing(id);
          
          if (s.status === 'error') {
            spinner.fail('SOV processing failed');
          } else {
            spinner.succeed('SOV processing complete');
          }
          
          if (options.json) {
            json(s);
          } else {
            showSOVDetails(s);
          }
          
        } catch (err) {
          spinner.fail((err as Error).message);
          process.exit(1);
        }
      } else {
        const spinner = ora('Fetching SOV status...').start();
        
        try {
          const { sovs } = await client.sov.list({ limit: 100 });
          const s = sovs.find(x => x.id === id);
          
          if (!s) {
            spinner.fail('SOV not found');
            process.exit(1);
          }
          
          spinner.succeed(`Status: ${formatSOVStatus(s.status)}`);
          
          if (options.json) {
            json(s);
          } else {
            showSOVDetails(s);
          }
          
        } catch (err) {
          spinner.fail('Failed to fetch SOV');
          failWith('API error', err);
        }
      }
    });

  return sov;
}

function formatSOVStatus(status: string): string {
  switch (status) {
    case 'parsed':
    case 'validated':
      return `✓ ${  status}`;
    case 'parsing':
    case 'uploaded':
      return `◐ ${  status}`;
    case 'error':
      return '✗ error';
    default:
      return status;
  }
}

function showSOVDetails(s: any): void {
  console.log();
  console.log(`  File:           ${s.fileName}`);
  console.log(`  Status:         ${formatSOVStatus(s.status)}`);
  console.log(`  Line:           ${s.lineOfBusiness || 'property'}`);
  if (s.effectiveDate) console.log(`  Effective:      ${formatDate(s.effectiveDate)}`);
  if (s.expirationDate) console.log(`  Expiration:     ${formatDate(s.expirationDate)}`);
  if (s.totalLocations) console.log(`  Locations:      ${s.totalLocations}`);
  if (s.totalTIV) console.log(`  Total TIV:      ${formatCurrency(s.totalTIV)}`);
  console.log(`  Created:        ${formatDate(s.createdAt)}`);
}
