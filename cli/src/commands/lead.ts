/**
 * Lead commands for the Delegance CLI
 *
 * Send a prospect business to Delegance. Needs the `write` scope.
 */

import { Command } from 'commander';
import ora from 'ora';
import type { CreateLeadInput } from '@delegance/sdk';
import { getClient, failWith } from '../utils/client';
import { error, json, keyValue } from '../utils/output';

/** Build the lead body from CLI options. Exported for tests. */
export function buildLeadInput(options: Record<string, string | undefined>): CreateLeadInput {
  const input: CreateLeadInput = {
    name: options.name ?? '',
    contactEmail: options.email ?? '',
    legalName: options.legalName,
    industry: options.industry,
    contactPhone: options.phone,
    website: options.website,
    companySize: options.size,
    description: options.description,
    naicsCode: options.naics,
    sicCode: options.sic,
    state: options.state?.toUpperCase(),
    externalId: options.externalId,
    source: options.source,
    notes: options.notes,
  };
  if (options.street || options.city || options.zip) {
    input.address = {
      street: options.street ?? '',
      suite: options.suite,
      city: options.city ?? '',
      state: (options.addressState ?? options.state ?? '').toUpperCase(),
      zip: options.zip ?? '',
    };
  }
  return input;
}

export function createLeadCommand(): Command {
  const lead = new Command('lead')
    .alias('leads')
    .description('Send prospect businesses to Delegance');

  lead
    .command('create')
    .description('Create a lead (idempotent on --external-id and contact email)')
    .requiredOption('-n, --name <name>', 'Business name')
    .requiredOption('-e, --email <email>', 'Contact email')
    .option('--legal-name <name>', 'Legal name, if different')
    .option('-i, --industry <industry>', 'Industry')
    .option('-p, --phone <phone>', 'Contact phone')
    .option('-w, --website <url>', 'Website (full URL)')
    .option('--size <size>', 'Company size')
    .option('-d, --description <text>', 'What the business does')
    .option('--naics <code>', 'NAICS code')
    .option('--sic <code>', 'SIC code')
    .option('-s, --state <state>', 'Two-letter state code')
    .option('--street <street>', 'Street address')
    .option('--suite <suite>', 'Suite')
    .option('--city <city>', 'City')
    .option('--address-state <state>', 'Address state (defaults to --state)')
    .option('--zip <zip>', 'ZIP code')
    .option('--external-id <id>', 'Your id for this lead')
    .option('--source <source>', 'Lead source label')
    .option('--notes <notes>', 'Notes for the broker')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const input = buildLeadInput(options);
      if (input.address && (!input.address.street || !input.address.city || !input.address.state || !input.address.zip)) {
        error('An address needs --street, --city, --zip, and a state');
        process.exit(1);
      }

      const client = getClient();
      const spinner = ora('Creating lead...').start();
      try {
        const result = await client.leads.create(input);
        spinner.succeed(result.message);
        if (options.json) json(result);
        else keyValue({ 'Company ID': result.companyId });
      } catch (err) {
        spinner.fail('Failed to create lead');
        failWith('API error', err);
      }
    });

  return lead;
}
