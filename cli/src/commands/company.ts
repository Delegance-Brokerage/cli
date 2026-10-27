/**
 * Company commands for the Delegance CLI
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { type CreateCompanyInput, type CompanySize } from '@delegance/sdk';
import { setConfig, getConfigValue } from '../utils/config';
import { getClient, failWith } from '../utils/client';
import { success, error, info, warn, table, json, header, keyValue, formatDate } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

export function createCompanyCommand(): Command {
  const company = new Command('company')
    .alias('companies')
    .description('Manage companies');

  // List companies
  company
    .command('list')
    .description('List companies')
    .option('--include-created', 'Include companies created via this API key')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching companies...').start();

      try {
        const companies = await client.companies.list({
          includeCreated: options.includeCreated
        });

        spinner.succeed(`Found ${companies.length} companies`);

        if (companies.length === 0) {
          info('No companies found');
          return;
        }

        if (options.json) {
          json(companies);
        } else {
          console.log();
          table(
            ['ID', 'Name', 'Industry', 'Size', 'Created'],
            companies.map(c => [
              `${c.id.substring(0, 8)}...`,
              c.name,
              c.industry,
              c.companySize,
              formatDate(c.createdAt)
            ])
          );
        }

      } catch (err) {
        spinner.fail('Failed to list companies');
        failWith('API error', err);
      }
    });

  // Create company
  company
    .command('create')
    .description('Create a new company')
    .option('-n, --name <name>', 'Company name')
    .option('-i, --industry <industry>', 'Industry')
    .option('-s, --size <size>', 'Company size (1, 2-10, 11-25, 26-50, 51-100, 100-499, 500+)')
    .option('-e, --email <email>', 'Contact email')
    .option('--fein <fein>', 'FEIN (XX-XXXXXXX)')
    .option('--website <url>', 'Website URL')
    .option('--external-id <id>', 'External ID for deduplication')
    .option('--interactive', 'Interactive mode with prompts')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      let companyData: CreateCompanyInput;

      if (options.interactive || (!options.name && !options.industry)) {
        // Interactive mode
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'name',
            message: 'Company name:',
            default: options.name,
            validate: (input: string) => input.length > 0 || 'Name is required'
          },
          {
            type: 'input',
            name: 'industry',
            message: 'Industry:',
            default: options.industry,
            validate: (input: string) => input.length > 0 || 'Industry is required'
          },
          {
            type: 'list',
            name: 'companySize',
            message: 'Company size:',
            choices: ['1', '2-10', '11-25', '26-50', '51-100', '100-499', '500+'],
            default: options.size
          },
          {
            type: 'input',
            name: 'contactEmail',
            message: 'Contact email:',
            default: options.email,
            validate: (input: string) => {
              if (!input) return 'Email is required';
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) return 'Invalid email format';
              return true;
            }
          },
          {
            type: 'input',
            name: 'fein',
            message: 'FEIN (XX-XXXXXXX, optional):',
            default: options.fein
          },
          {
            type: 'input',
            name: 'website',
            message: 'Website (optional):',
            default: options.website
          }
        ]);

        companyData = {
          name: answers.name,
          industry: answers.industry,
          companySize: answers.companySize as CompanySize,
          contactEmail: answers.contactEmail,
          fein: answers.fein || undefined,
          website: answers.website || undefined,
          externalId: options.externalId
        };
      } else {
        // Command line mode
        if (!options.name || !options.industry || !options.size || !options.email) {
          error('Missing required options');
          info('Required: --name, --industry, --size, --email');
          info('Or use --interactive for guided input');
          process.exit(1);
        }

        companyData = {
          name: options.name,
          industry: options.industry,
          companySize: options.size as CompanySize,
          contactEmail: options.email,
          fein: options.fein,
          website: options.website,
          externalId: options.externalId
        };
      }

      const client = getClient();
      const spinner = ora('Creating company...').start();

      try {
        const company = await client.companies.create(companyData);

        spinner.succeed('Company created');

        if (options.json) {
          json(company);
        } else {
          console.log();
          success(`Created company: ${company.name}`);
          keyValue({
            'ID': company.id,
            'Name': company.name,
            'Industry': company.industry,
            'Size': company.companySize,
            'Contact': company.contactEmail,
            'Created': formatDate(company.createdAt)
          });
        }

      } catch (err) {
        spinner.fail('Failed to create company');
        failWith('API error', err);
      }
    });

  // Set default company
  company
    .command('use <companyId>')
    .description('Set default company for subsequent commands')
    .action(async (companyId: string) => {
      // Verify the company exists
      const client = getClient();
      const spinner = ora('Verifying company...').start();

      try {
        const companies = await client.companies.list({ includeCreated: true });
        const found = companies.find(c => c.id === companyId || c.id.startsWith(companyId));

        if (!found) {
          spinner.fail('Company not found');
          error(`No company found with ID starting with: ${companyId}`);
          process.exit(1);
        }

        setConfig('defaultCompanyId', found.id);
        spinner.succeed(`Default company set to: ${found.name}`);

      } catch (err) {
        spinner.fail('Failed to verify company');
        failWith('API error', err);
      }
    });

  // Show current default
  company
    .command('current')
    .description('Show current default company')
    .action(async () => {
      const companyId = getConfigValue('defaultCompanyId');

      if (!companyId) {
        info('No default company set');
        info(`Use "${cliInvocation()} company use <id>" to set one`);
        return;
      }

      const client = getClient();
      const spinner = ora('Fetching company details...').start();

      try {
        const companies = await client.companies.list({ includeCreated: true });
        const company = companies.find(c => c.id === companyId);

        if (!company) {
          spinner.warn('Default company no longer accessible');
          return;
        }

        spinner.succeed('Current default company');
        console.log();
        keyValue({
          'ID': company.id,
          'Name': company.name,
          'Industry': company.industry
        });

      } catch (err) {
        spinner.fail('Failed to fetch company');
        failWith('API error', err);
      }
    });

  return company;
}
