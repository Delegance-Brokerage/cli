/**
 * Policy commands for the Delegance CLI
 * 
 * Manage insurance policies.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import type { CancellationSignInput, DeleganceClient } from '@delegance/sdk';
import { getClient, failWith } from '../utils/client';
import { success, error, info, warn, table, json, header, formatDate, formatCurrency } from '../utils/output';
import { cliInvocation } from '../utils/invocation';
import { coverageName } from '../utils/coverage-names';

export function createPolicyCommand(): Command {
  const policy = new Command('policy')
    .alias('policies')
    .description('Manage insurance policies');

  // List policies
  policy
    .command('list')
    .alias('ls')
    .description('List all policies')
    .option('-s, --status <status>', 'Filter by status (active, expired, all)', 'active')
    .option('-t, --type <type>', 'Filter by policy type')
    .option('-l, --limit <n>', 'Maximum results', '50')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching policies...').start();

      try {
        const { policies, count } = await client.policies.list({
          status: options.status === 'all' ? undefined : options.status,
          policyType: options.type,
          limit: parseInt(options.limit)
        });

        spinner.succeed(`Found ${count} policies`);

        if (policies.length === 0) {
          info('No policies found');
          return;
        }

        if (options.json) {
          json(policies);
        } else {
          console.log();
          table(
            ['Carrier', 'Type', 'Policy #', 'Expiry', 'Status', 'Premium'],
            policies.map(p => [
              p.carrier || 'Unknown',
              (p.policyType ? coverageName(p.policyType) : p.name) || '-',
              p.policyNumber || '-',
              p.expiryDate ? formatDate(p.expiryDate) : '-',
              formatPolicyStatus(p.isActive, p.daysUntilExpiry),
              p.premium ? formatCurrency(p.premium) : '-'
            ])
          );
        }

      } catch (err) {
        spinner.fail('Failed to fetch policies');
        failWith('API error', err);
      }
    });

  // Expiring policies
  policy
    .command('expiring [days]')
    .description('Show policies expiring soon')
    .option('--json', 'Output as JSON')
    .action(async (days = '30', options) => {
      const client = getClient();
      const daysNum = parseInt(days, 10);
      const spinner = ora(`Fetching policies expiring in ${daysNum} days...`).start();

      try {
        const { policies, count } = await client.policies.getExpiring(daysNum);

        spinner.succeed(`Found ${count} policies expiring in ${daysNum} days`);

        if (policies.length === 0) {
          success('No policies expiring soon!');
          return;
        }

        if (options.json) {
          json(policies);
        } else {
          console.log();
          
          // Group by urgency
          const urgent = policies.filter(p => (p.daysUntilExpiry || 0) <= 7);
          const soon = policies.filter(p => (p.daysUntilExpiry || 0) > 7 && (p.daysUntilExpiry || 0) <= 30);
          const later = policies.filter(p => (p.daysUntilExpiry || 0) > 30);

          if (urgent.length > 0) {
            warn(`⚠️  Expiring within 7 days (${urgent.length}):`);
            for (const p of urgent) {
              console.log(`   - ${p.carrier} ${p.policyType ? coverageName(p.policyType) : p.name} - expires ${formatDate(p.expiryDate)}`);
            }
            console.log();
          }

          if (soon.length > 0) {
            info(`📅 Expiring within 30 days (${soon.length}):`);
            for (const p of soon) {
              console.log(`   - ${p.carrier} ${p.policyType ? coverageName(p.policyType) : p.name} - expires ${formatDate(p.expiryDate)}`);
            }
            console.log();
          }

          if (later.length > 0) {
            console.log(`📆 Expiring later (${later.length}):`);
            for (const p of later) {
              console.log(`   - ${p.carrier} ${p.policyType ? coverageName(p.policyType) : p.name} - ${p.daysUntilExpiry} days`);
            }
          }
        }

      } catch (err) {
        spinner.fail('Failed to fetch expiring policies');
        failWith('API error', err);
      }
    });

  // Get single policy
  policy
    .command('get <id>')
    .description('Get policy details')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const client = getClient();
      const spinner = ora('Fetching policy...').start();

      try {
        const found = await client.policies.get(id);

        if (!found) {
          spinner.fail('Policy not found');
          process.exit(1);
        }

        spinner.succeed('Policy found');

        if (options.json) {
          json(found);
        } else {
          const { policy: p, coverages } = found;
          console.log();
          header(`${p.carrier} - ${p.policyType ? coverageName(p.policyType) : p.name}`);
          console.log();
          console.log(`  Policy #:       ${p.policyNumber || 'N/A'}`);
          console.log(`  Carrier:        ${p.carrier}`);
          console.log(`  Type:           ${p.policyType ? coverageName(p.policyType) : 'N/A'}`);
          console.log(`  Effective:      ${p.effectiveDate ? formatDate(p.effectiveDate) : 'N/A'}`);
          console.log(`  Expiry:         ${p.expiryDate ? formatDate(p.expiryDate) : 'N/A'}`);
          console.log(`  Status:         ${formatPolicyStatus(p.isActive, p.daysUntilExpiry)}`);
          console.log();
          console.log(`  Premium:        ${p.premium ? formatCurrency(p.premium) : 'N/A'}`);
          console.log(`  Deductible:     ${p.deductible ? formatCurrency(p.deductible) : 'N/A'}`);
          console.log(`  Occurrence:     ${p.occurrenceLimit ? formatCurrency(p.occurrenceLimit) : 'N/A'}`);
          console.log(`  Aggregate:      ${p.aggregateLimit ? formatCurrency(p.aggregateLimit) : 'N/A'}`);
          if (p.naicCode) {
            console.log(`  NAIC:           ${p.naicCode}`);
          }
          if (coverages.length > 0) {
            console.log();
            table(
              ['Coverage', 'Limit', 'Deductible'],
              coverages.map(c => [
                c.coverageType,
                c.limit ? formatCurrency(c.limit) : '-',
                c.deductible ? formatCurrency(c.deductible) : '-'
              ])
            );
          }
        }

      } catch (err) {
        spinner.fail('Failed to fetch policy');
        failWith('API error', err);
      }
    });

  policy
    .command('docs <id>')
    .description('The documents a policy was read from: declarations, forms, endorsements')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const client = getClient();
      try {
        const found = await client.policies.get(id);
        if (!found) {
          error('Policy not found');
          process.exit(1);
        }
        // Bounded: a policy lists a handful of source documents.
        const ids = (found.policy.sourceDocuments ?? []).slice(0, 20);
        const docs = await Promise.all(ids.map(async (docId) => {
          try {
            const d = await client.documents.get(docId);
            return { id: d.id, fileName: d.fileName, documentType: d.documentType ?? null, status: d.status, createdAt: d.createdAt };
          } catch {
            return { id: docId, fileName: null, documentType: null, status: 'unavailable', createdAt: null };
          }
        }));
        if (options.json) {
          json({ policyId: id, documents: docs });
          return;
        }
        if (docs.length === 0) {
          info(`No source documents are linked to this policy yet. Upload one with: ${cliInvocation()} document upload <file>`);
          return;
        }
        table(
          ['Document', 'File', 'Type', 'Status', 'Added'],
          docs.map((d) => [d.id, d.fileName ?? '-', d.documentType ?? '-', d.status, d.createdAt ? formatDate(d.createdAt) : '-']),
        );
        info(`Download one with: ${cliInvocation()} document status <documentId>`);
      } catch (err) {
        failWith('API error', err);
      }
    });

  policy
    .command('cancel <policyId>')
    .description('Ask to cancel a policy (owner or admin only); sign now with an emailed code, and your broker checks for a coverage gap first')
    .requiredOption('--effective <date>', 'Cancellation date, YYYY-MM-DD (coverage ends at 12:01 AM that day)')
    .requiredOption('--reason <reason>', 'replaced | business_closed | sold | not_needed | other')
    .option('--replacement <policyId>', 'The policy that replaces this one (required with --reason replaced)')
    .option('--signer-name <name>', 'Sign now: your full name')
    .option('--signer-title <title>', 'Sign now: your title')
    .option('--attest', 'Sign now: you are authorized to bind the named insured')
    .option('--json', 'Output as JSON')
    .action(async (policyId: string, options) => {
      const sig = signatureFrom(options);
      if (sig === 'partial') {
        failWith('Missing signer details', new Error('To sign now, pass --signer-name, --signer-title and --attest together.'));
        return;
      }
      const client = getClient();
      const spinner = ora('Requesting cancellation...').start();
      try {
        const out = await client.policies.requestCancellation(policyId, {
          requestedEffectiveDate: options.effective,
          reason: options.reason,
          replacementPolicyId: options.replacement,
        });
        spinner.succeed('Cancellation requested');
        if (options.json) {
          json(out);
          return;
        }
        console.log();
        console.log(`  Request:     ${out.request.id}`);
        console.log(`  Status:      ${out.request.status.replace(/_/g, ' ')}`);
        console.log(`  Continuity:  ${out.request.continuity.replace(/_/g, ' ')}`);
        console.log();
        if (sig) {
          await signWithStepUp(client, out.request.id, sig, undefined, undefined);
        } else {
          info(`Sign here: ${out.signatureUrl}`);
          info(`Or sign from here: ${cliInvocation()} policy sign ${out.request.id} --signer-name "..." --signer-title "..." --attest`);
        }
        info(`Check progress with "${cliInvocation()} policy cancellation ${out.request.id}"`);
      } catch (err) {
        spinner.fail('Could not request the cancellation');
        failWith('API error', err);
      }
    });

  policy
    .command('sign <requestId>')
    .description('Sign a cancellation request as an owner or admin; we email you a 6-digit code to confirm')
    .requiredOption('--signer-name <name>', 'Your full name')
    .requiredOption('--signer-title <title>', 'Your title')
    .requiredOption('--attest', 'You are authorized to bind the named insured')
    .option('--step-up <id>', 'Finish an earlier attempt: the stepUpId the code email belongs to')
    .option('--code <code>', 'The 6-digit code (with --step-up), for scripts')
    .action(async (requestId: string, options) => {
      const client = getClient();
      const sig = signatureFrom(options);
      if (!sig || sig === 'partial') {
        failWith('Missing signer details', new Error('Pass --signer-name, --signer-title and --attest.'));
        return;
      }
      try {
        await signWithStepUp(client, requestId, sig, options.stepUp, options.code);
      } catch (err) {
        failWith('Could not sign', err);
      }
    });

  policy
    .command('cancellation <requestId>')
    .description('Show a cancellation request\'s status')
    .option('--json', 'Output as JSON')
    .action(async (requestId: string, options) => {
      const client = getClient();
      try {
        const r = await client.policies.getCancellation(requestId);
        if (options.json) {
          json(r);
          return;
        }
        console.log(`  Status:      ${r.status.replace(/_/g, ' ')}`);
        console.log(`  Requested:   ${r.requestedEffectiveDate}`);
        console.log(`  Continuity:  ${r.continuity.replace(/_/g, ' ')}`);
        if (r.confirmationNumber) console.log(`  Confirmed:   ${r.confirmedEffectiveDate} (confirmation ${r.confirmationNumber})`);
      } catch (err) {
        failWith('API error', err);
      }
    });

  return policy;
}

type Signature = Omit<CancellationSignInput, 'stepUpId' | 'code'>;

/** null: no signer flags. 'partial': some but not all. */
function signatureFrom(o: { signerName?: string; signerTitle?: string; attest?: boolean }): Signature | null | 'partial' {
  const given = [o.signerName, o.signerTitle, o.attest].filter((v) => v !== undefined && v !== false).length;
  if (given === 0) return null;
  if (given < 3) return 'partial';
  return { signerName: String(o.signerName), signerTitle: String(o.signerTitle), attestAuthority: true };
}

/**
 * Sign with the step-up code (2026-09-23). The first call emails a code; the
 * second carries it. With --step-up and --code, only the second call runs.
 */
async function signWithStepUp(client: DeleganceClient, requestId: string, sig: Signature, stepUpId?: string, presetCode?: string): Promise<void> {
  let id = stepUpId;
  if (!id || !presetCode) {
    const first = await client.policies.signCancellation(requestId, sig);
    if (!('stepUpRequired' in first)) {
      success('Signed. Your broker checks the request and sends it to the carrier.');
      return;
    }
    id = first.stepUpId;
    info(`We emailed a 6-digit code to ${first.sentTo}. It expires in 10 minutes.`);
  }
  let code = presetCode;
  if (!code) {
    if (!process.stdin.isTTY) {
      warn(`No terminal to type the code in. Finish with: ${cliInvocation()} policy sign ${requestId} --signer-name "${sig.signerName}" --signer-title "${sig.signerTitle}" --attest --step-up ${id} --code <code>`);
      return;
    }
    const answer = await inquirer.prompt([{
      type: 'input',
      name: 'code',
      message: 'Code from your email:',
      validate: (v: string) => /^\d{6}$/.test(v.trim()) || 'Enter the 6 digits from the email',
    }]);
    code = String(answer.code).trim();
  }
  await client.policies.signCancellation(requestId, { ...sig, stepUpId: id, code });
  success('Signed. Your broker checks the request and sends it to the carrier.');
}

function formatPolicyStatus(isActive: boolean, daysUntilExpiry?: number | null): string {
  if (!isActive) {
    return '✗ Expired';
  }
  if (daysUntilExpiry !== null && daysUntilExpiry !== undefined) {
    if (daysUntilExpiry <= 7) {
      return `⚠️ ${daysUntilExpiry}d`;
    }
    if (daysUntilExpiry <= 30) {
      return `📅 ${daysUntilExpiry}d`;
    }
  }
  return '✓ Active';
}
