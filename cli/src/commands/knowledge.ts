/**
 * Knowledge commands for the Delegance CLI
 *
 * Search the company's notecards and document chunks, list notecards, and
 * read the structured facts extracted from one document.
 */

import { Command } from 'commander';
import ora from 'ora';
import { getClient, failWith } from '../utils/client';
import { info, table, json, header, keyValue, formatCurrency, formatDate } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

const SEARCH_TYPES = ['notecard', 'document_chunk'] as const;

export function createKnowledgeCommand(): Command {
  const knowledge = new Command('knowledge')
    .alias('kb')
    .description('Search notecards and document facts');

  knowledge
    .command('search <query...>')
    .description('Search notecards and document text')
    .option('-t, --type <type>', `Limit to one result type (${SEARCH_TYPES.join(', ')})`)
    .option('-l, --limit <n>', 'Maximum results', '10')
    .option('--json', 'Output as JSON')
    .action(async (queryParts: string[], options) => {
      const client = getClient();
      const query = queryParts.join(' ');
      const spinner = ora('Searching...').start();
      try {
        const { data } = await client.knowledge.search({
          query,
          types: options.type ? [options.type] : undefined,
          limit: parseInt(options.limit)
        });
        spinner.succeed(`Found ${data.length} results`);
        if (options.json) {
          json(data);
          return;
        }
        for (const r of data) {
          console.log();
          console.log(`  ${r.title}  (${r.type}, score ${r.score.toFixed(2)})`);
          if (r.summary) console.log(`    ${r.summary}`);
          for (const h of r.highlights.slice(0, 2)) console.log(`    > ${h}`);
        }
      } catch (err) {
        spinner.fail('Search failed');
        failWith('API error', err);
      }
    });

  knowledge
    .command('notecards')
    .alias('cards')
    .description('List notecards')
    .option('-t, --type <type>', 'Filter by template type')
    .option('-l, --limit <n>', 'Maximum results', '25')
    .option('--cursor <cursor>', 'Page cursor from a previous list')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching notecards...').start();
      try {
        const { data, pagination } = await client.knowledge.notecards({
          type: options.type,
          limit: parseInt(options.limit),
          cursor: options.cursor
        });
        spinner.succeed(`Found ${data.length} notecards`);
        if (options.json) {
          json({ data, pagination });
          return;
        }
        if (data.length > 0) {
          console.log();
          table(
            ['ID', 'Type', 'Title', 'Updated'],
            data.map(n => [n.id, n.templateType, n.title, formatDate(n.updatedAt ?? n.createdAt)])
          );
        }
        if (pagination.hasMore && pagination.nextCursor) {
          info(`More: ${cliInvocation()} knowledge notecards --cursor ${pagination.nextCursor}`);
        }
      } catch (err) {
        spinner.fail('Failed to list notecards');
        failWith('API error', err);
      }
    });

  knowledge
    .command('facts <documentId>')
    .description('Show the structured facts extracted from a document')
    .option('--json', 'Output as JSON')
    .action(async (documentId: string, options) => {
      const client = getClient();
      const spinner = ora('Fetching document facts...').start();
      try {
        const facts = await client.knowledge.documentFacts(documentId);
        spinner.stop();
        if (options.json) {
          json(facts);
          return;
        }
        header('Document facts');
        keyValue({ 'Carriers': facts.carriers, ...facts.dates });
        if (facts.policies.length > 0) {
          console.log();
          table(
            ['Type', 'Policy #', 'Carrier', 'Effective', 'Expires', 'Premium'],
            facts.policies.map(p => [
              p.policyType,
              p.policyNumber ?? '-',
              p.carrierName ?? '-',
              p.effectiveDate ?? '-',
              p.expirationDate ?? '-',
              p.premium ? formatCurrency(p.premium) : '-'
            ])
          );
        }
        if (facts.coverages.length > 0) {
          console.log();
          table(
            ['Coverage', 'Limit', 'Deductible'],
            facts.coverages.map(c => [
              c.type,
              c.limit ? formatCurrency(c.limit) : '-',
              c.deductible ? formatCurrency(c.deductible) : '-'
            ])
          );
        }
      } catch (err) {
        spinner.fail('Failed to fetch document facts');
        failWith('API error', err);
      }
    });

  return knowledge;
}
