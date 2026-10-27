/**
 * Document commands for the Delegance CLI
 */

import { Command } from 'commander';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { type DocumentType, type DocumentStatus } from '@delegance/sdk';
import { getClient, getCompanyId, failWith } from '../utils/client';
import { 
  success, error, info, warn, table, json, header, keyValue,
  formatDate, formatFileSize, formatStatus 
} from '../utils/output';
import { cliInvocation } from '../utils/invocation';

/** Where a document's extraction stands. Exported for tests. */
export function extractionOutcome(status: string): 'done' | 'failed' | 'pending' {
  if (status === 'completed' || status === 'processed') return 'done';
  if (status === 'error' || status === 'failed') return 'failed';
  return 'pending';
}

export function createDocumentCommand(): Command {
  const doc = new Command('doc')
    .alias('docs')
    .alias('document')
    .alias('documents')
    .description('Manage documents');

  // Upload document(s)
  doc
    .command('upload <files...>')
    .description('Upload one or more documents')
    .option('-c, --company <id>', 'Company ID (or use default)')
    .option('-t, --type <type>', 'Document type (policy, loss_run, financial_statement, sov, application, certificate, endorsement, bor, other)')
    .option('--external-id <id>', 'External ID for reference')
    .option('-w, --wait', 'Wait for extraction to complete')
    .option('--timeout <ms>', 'Timeout for waiting (default: 120000)', '120000')
    .option('--json', 'Output as JSON')
    .action(async (filePatterns: string[], options) => {
      const companyId = getCompanyId(options);
      const client = getClient();

      // Expand glob patterns
      let files: string[] = [];
      for (const pattern of filePatterns) {
        if (pattern.includes('*')) {
          const matches = await glob(pattern);
          files.push(...matches);
        } else {
          files.push(pattern);
        }
      }

      // Filter to existing files
      files = files.filter(f => {
        if (!fs.existsSync(f)) {
          warn(`File not found: ${f}`);
          return false;
        }
        if (fs.statSync(f).isDirectory()) {
          warn(`Skipping directory: ${f}`);
          return false;
        }
        return true;
      });

      if (files.length === 0) {
        error('No valid files to upload');
        process.exit(1);
      }

      info(`Uploading ${files.length} file(s) to company ${companyId.substring(0, 8)}...`);
      console.log();

      const results: { file: string; docId?: string; status: string; error?: string }[] = [];

      for (const filePath of files) {
        const fileName = path.basename(filePath);
        const spinner = ora(`Uploading ${fileName}...`).start();

        try {
          const fileBuffer = fs.readFileSync(filePath);
          
          const document = await client.documents.upload({
            companyId,
            file: fileBuffer,
            fileName,
            documentType: options.type as DocumentType | undefined,
            externalId: options.externalId
          });

          spinner.succeed(`Uploaded ${fileName} (${document.id.substring(0, 8)}...)`);
          results.push({ file: fileName, docId: document.id, status: 'uploaded' });

          // Optionally wait for extraction
          if (options.wait) {
            const waitSpinner = ora(`  Processing ${fileName}...`).start();
            
            try {
              const result = await client.documents.waitForExtraction(document.id, {
                timeoutMs: parseInt(options.timeout),
                onStatusChange: (status) => {
                  waitSpinner.text = `  Processing ${fileName}: ${status}`;
                }
              });

              if (result.status === 'completed' || result.status === 'processed') {
                waitSpinner.succeed(`  Processed ${fileName}: ${result.extraction?.policies.length || 0} policies found`);
                results[results.length - 1].status = 'completed';
              } else {
                waitSpinner.warn(`  Processing ${fileName}: ${result.status}`);
                results[results.length - 1].status = result.status;
              }
            } catch (waitErr) {
              waitSpinner.fail(`  Processing failed: ${(waitErr as Error).message}`);
              results[results.length - 1].status = 'error';
              results[results.length - 1].error = (waitErr as Error).message;
            }
          }

        } catch (err) {
          spinner.fail(`Failed to upload ${fileName}`);
          results.push({ file: fileName, status: 'error', error: (err as Error).message });
        }
      }

      // Summary
      console.log();
      const successCount = results.filter(r => r.status !== 'error').length;
      const errorCount = results.filter(r => r.status === 'error').length;

      if (errorCount === 0) {
        success(`Successfully uploaded ${successCount} file(s)`);
      } else {
        warn(`Uploaded ${successCount} file(s), ${errorCount} failed`);
      }

      if (options.json) {
        json(results);
      }
    });

  // List documents
  doc
    .command('list')
    .description('List documents')
    .option('-c, --company <id>', 'Company ID (or use default)')
    .option('-t, --type <type>', 'Filter by document type')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <n>', 'Maximum results (default: 50)', '50')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const companyId = getCompanyId(options);
      const client = getClient();
      const spinner = ora('Fetching documents...').start();

      try {
        const { documents, pagination } = await client.documents.list({
          companyId,
          documentType: options.type as DocumentType | undefined,
          status: options.status as DocumentStatus | undefined,
          limit: parseInt(options.limit)
        });

        spinner.succeed(`Found ${pagination.total} documents`);

        if (documents.length === 0) {
          info('No documents found');
          return;
        }

        if (options.json) {
          json({ documents, pagination });
        } else {
          console.log();
          table(
            ['ID', 'File Name', 'Type', 'Status', 'Size', 'Created'],
            documents.map(d => [
              `${d.id.substring(0, 8)}...`,
              d.fileName.length > 30 ? `${d.fileName.substring(0, 27)}...` : d.fileName,
              d.documentType || '-',
              formatStatus(d.status),
              formatFileSize(d.fileSize),
              formatDate(d.createdAt)
            ])
          );

          if (pagination.hasMore) {
            console.log();
            info(`Showing ${documents.length} of ${pagination.total}. Use --limit to see more.`);
          }
        }

      } catch (err) {
        spinner.fail('Failed to list documents');
        failWith('API error', err);
      }
    });

  // Get document status
  doc
    .command('status <documentId>')
    .alias('get')
    .description('Get document details and extraction status')
    .option('--json', 'Output as JSON')
    .action(async (documentId: string, options) => {
      const client = getClient();
      const spinner = ora('Fetching document...').start();

      try {
        const document = await client.documents.get(documentId);
        spinner.succeed('Document retrieved');

        if (options.json) {
          json(document);
        } else {
          console.log();
          header('Document Details');
          keyValue({
            'ID': document.id,
            'File Name': document.fileName,
            'Type': document.documentType || '(not classified)',
            'Status': formatStatus(document.status),
            'Size': formatFileSize(document.fileSize),
            'Created': formatDate(document.createdAt),
            'Updated': formatDate(document.updatedAt)
          });

          if (document.extraction) {
            console.log();
            header('Extraction Results');
            keyValue({
              'Has Text': document.extraction.hasText,
              'Text Length': document.extraction.textLength,
              'Policies Found': document.extraction.policies.length
            });

            if (document.extraction.policies.length > 0) {
              console.log();
              info('Extracted Policies:');
              table(
                ['ID', 'Type', 'Number', 'Carrier', 'Effective', 'Expiration'],
                document.extraction.policies.map(p => [
                  `${p.id.substring(0, 8)}...`,
                  p.policyType,
                  p.policyNumber || '-',
                  p.carrierName || '-',
                  p.effectiveDate || '-',
                  p.expirationDate || '-'
                ])
              );
            }
          }

          if (document.processing) {
            console.log();
            info(document.processing.message);
          }

          if (document.error) {
            console.log();
            error('Processing Error', document.error.message);
          }
        }

      } catch (err) {
        spinner.fail('Failed to get document');
        failWith('API error', err);
      }
    });

  // Wait for document processing
  doc
    .command('wait <documentId>')
    .description('Wait for document processing to complete')
    .option('--timeout <ms>', 'Timeout in milliseconds (default: 120000)', '120000')
    .option('--json', 'Output as JSON')
    .action(async (documentId: string, options) => {
      const client = getClient();
      const spinner = ora('Waiting for processing...').start();

      try {
        const result = await client.documents.waitForExtraction(documentId, {
          timeoutMs: parseInt(options.timeout),
          onStatusChange: (status) => {
            spinner.text = `Processing: ${status}`;
          }
        });

        const outcome = extractionOutcome(result.status);
        if (outcome === 'done') {
          spinner.succeed('Processing complete');
          
          if (options.json) {
            json(result);
          } else {
            info(`Found ${result.extraction?.policies.length || 0} policies`);
          }
        } else if (outcome === 'failed') {
          spinner.fail('Processing failed');
          error(result.error?.message || 'Unknown error');
          process.exit(1);
        } else {
          spinner.warn(`Processing status: ${result.status}`);
          info('Document is still being processed. Try again later.');
        }

      } catch (err) {
        spinner.fail('Wait failed');
        failWith('Error', err);
      }
    });

  // Re-run extraction on a document
  doc
    .command('reprocess <documentId>')
    .description('Re-run extraction on a document (limited retries per day)')
    .option('-w, --wait', 'Wait for extraction to complete')
    .option('--timeout <ms>', 'Timeout for waiting (default: 120000)', '120000')
    .option('--json', 'Output as JSON')
    .action(async (documentId: string, options) => {
      const client = getClient();
      const spinner = ora('Requesting reprocess...').start();

      try {
        const result = await client.documents.reprocess(documentId);
        spinner.succeed(result.message);

        if (options.wait) {
          const waitSpinner = ora('Waiting for extraction...').start();
          const finished = await client.documents.waitForExtraction(documentId, {
            timeoutMs: parseInt(options.timeout)
          });
          const outcome = extractionOutcome(finished.status);
          if (options.json) json({ ...result, document: finished });
          if (outcome === 'done') {
            waitSpinner.succeed(`Extraction ${finished.status}`);
          } else if (outcome === 'failed') {
            waitSpinner.fail(`Extraction ${finished.status}`);
            if (!options.json) error(finished.error?.message || 'Unknown error');
            process.exit(1);
          } else {
            waitSpinner.warn(`Extraction still ${finished.status}`);
            if (!options.json) info(`Run "${cliInvocation()} doc wait ${documentId}" to keep following it`);
          }
          return;
        }

        if (options.json) {
          json(result);
        } else {
          info(`${result.reprocessesRemaining} reprocess attempts left today`);
          info(`Run "${cliInvocation()} doc wait ${documentId}" to follow it`);
        }
      } catch (err) {
        spinner.fail('Failed to reprocess document');
        failWith('API error', err);
      }
    });

  // Archive / unarchive
  doc
    .command('archive <documentId>')
    .description('Archive a document (hide it from lists and answers)')
    .option('--json', 'Output as JSON')
    .action(async (documentId: string, options) => {
      const client = getClient();
      const spinner = ora('Archiving document...').start();
      try {
        const result = await client.documents.archive(documentId);
        spinner.succeed(result.message || 'Document archived');
        if (options.json) json(result);
      } catch (err) {
        spinner.fail('Failed to archive document');
        failWith('API error', err);
      }
    });

  doc
    .command('unarchive <documentId>')
    .description('Restore an archived document')
    .option('--json', 'Output as JSON')
    .action(async (documentId: string, options) => {
      const client = getClient();
      const spinner = ora('Restoring document...').start();
      try {
        const result = await client.documents.unarchive(documentId);
        spinner.succeed(result.message || 'Document restored');
        if (options.json) json(result);
      } catch (err) {
        spinner.fail('Failed to restore document');
        failWith('API error', err);
      }
    });

  return doc;
}
