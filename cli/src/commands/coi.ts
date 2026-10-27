/**
 * COI commands for the Delegance CLI
 * 
 * Generate and manage Certificates of Insurance.
 */

import { Command } from 'commander';
import ora from 'ora';
import inquirer from 'inquirer';
import { getClient, failWith } from '../utils/client';
import { success, error, info, warn, table, json, header, formatDate } from '../utils/output';
import { cliInvocation } from '../utils/invocation';
import { coverageName } from '../utils/coverage-names';

export function createCOICommand(): Command {
  const coi = new Command('coi')
    .description('Generate and manage Certificates of Insurance');

  // Generate COI
  coi
    .command('generate')
    .alias('create')
    .description('Generate a Certificate of Insurance')
    .option('-p, --policies <ids...>', 'Policy IDs to include')
    .option('-n, --holder-name <name>', 'Certificate holder name')
    .option('-a, --holder-address <address>', 'Certificate holder address')
    .option('--city <city>', 'Certificate holder city')
    .option('--state <state>', 'Certificate holder state (2-letter)')
    .option('--zip <zip>', 'Certificate holder ZIP')
    .option('-t, --type <type>', 'Certificate type (additional_insured, certificate_holder)', 'certificate_holder')
    .option('-i, --interactive', 'Interactive mode')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      
      let policyIds: string[] = options.policies || [];
      let {holderName} = options;
      let {holderAddress} = options;
      let {city} = options;
      let {state} = options;
      let {zip} = options;
      let certificateType = options.type;

      // Interactive mode
      if (options.interactive || !holderName || policyIds.length === 0) {
        // Fetch policies for selection
        const policiesSpinner = ora('Fetching active policies...').start();
        const { policies } = await client.policies.list({ status: 'active' });
        policiesSpinner.stop();

        if (policies.length === 0) {
          error('No active policies found');
          info(`Upload policy documents first with "${cliInvocation()} doc upload"`);
          process.exit(1);
        }

        const answers = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedPolicies',
            message: 'Select policies to include:',
            choices: policies.map(p => ({
              name: `${p.carrier} - ${p.policyType ? coverageName(p.policyType) : p.name} (${p.policyNumber || 'No #'})`,
              value: p.id,
              checked: policyIds.includes(p.id)
            })),
            validate: (input: string[]) => input.length > 0 || 'Select at least one policy'
          },
          {
            type: 'input',
            name: 'holderName',
            message: 'Certificate holder name:',
            default: holderName,
            validate: (input: string) => input.length >= 2 || 'Name must be at least 2 characters'
          },
          {
            type: 'input',
            name: 'holderAddress',
            message: 'Certificate holder address:',
            default: holderAddress
          },
          {
            type: 'input',
            name: 'city',
            message: 'City:',
            default: city
          },
          {
            type: 'input',
            name: 'state',
            message: 'State (2-letter):',
            default: state,
            validate: (input: string) => !input || input.length === 2 || 'State must be 2 letters (e.g., CA)'
          },
          {
            type: 'input',
            name: 'zip',
            message: 'ZIP code:',
            default: zip
          },
          {
            type: 'list',
            name: 'certificateType',
            message: 'Certificate type:',
            choices: [
              { name: 'Certificate Holder Only', value: 'certificate_holder' },
              { name: 'Additional Insured', value: 'additional_insured' }
            ],
            default: certificateType
          }
        ]);

        policyIds = answers.selectedPolicies;
        holderName = answers.holderName;
        holderAddress = answers.holderAddress;
        city = answers.city;
        state = answers.state;
        zip = answers.zip;
        certificateType = answers.certificateType;
      }

      if (!holderName) {
        error('Certificate holder name is required');
        process.exit(1);
      }

      const spinner = ora('Generating COI...').start();

      try {
        const result = await client.coi.generate({
          policyIds,
          certificateHolder: {
            name: holderName,
            address: holderAddress,
            city,
            state,
            zip
          },
          certificateType
        });

        spinner.succeed('COI generated successfully!');

        if (options.json) {
          json(result);
        } else {
          console.log();
          success(`Certificate of Insurance created for ${holderName}`);
          console.log();
          info(`COI ID: ${result.coiId}`);
          info(`Download URL: ${result.downloadUrl}`);
          info(`URL expires: ${formatDate(result.expiresAt)}`);
          console.log();
          console.log('Policies included:');
          for (const p of result.policiesIncluded) {
            console.log(`  - ${p.carrier} (${coverageName(p.policyType)})`);
          }
        }

      } catch (err) {
        spinner.fail('Failed to generate COI');
        failWith('API error', err);
      }
    });

  // List COIs
  coi
    .command('list')
    .alias('ls')
    .description('List generated COIs')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching COIs...').start();

      try {
        const { cois, count } = await client.coi.list(parseInt(options.limit));

        spinner.succeed(`Found ${count} COIs`);

        if (cois.length === 0) {
          info('No COIs generated yet');
          info(`Generate one with "${cliInvocation()} coi generate --interactive"`);
          return;
        }

        if (options.json) {
          json(cois);
        } else {
          console.log();
          table(
            ['ID', 'Certificate Holder', 'Type', 'Policies', 'Created'],
            cois.map(c => [
              `${c.id.substring(0, 8)}...`,
              c.certificateHolder,
              c.certificateType,
              String(c.policyIds?.length || 0),
              formatDate(c.createdAt)
            ])
          );
        }

      } catch (err) {
        spinner.fail('Failed to fetch COIs');
        failWith('API error', err);
      }
    });

  return coi;
}
