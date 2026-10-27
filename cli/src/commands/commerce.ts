/**
 * Bind, pay, bonds, and claims from the terminal.
 *
 *   bind <submissionId> <offerId>   bind: the carrier checkout when offered, else a broker review
 *   pay [paymentId]                 list payment requests, or open a checkout link
 *   bond quote|answer|status        surety bond quotes (the surety's page sells it)
 *   claim file|list|status          file and track claims
 */

import { Command } from 'commander';
import * as fs from 'fs';
import inquirer from 'inquirer';
import ora from 'ora';
import { DeleganceError } from '@delegance/sdk';
import type { BindRequestResult, PaymentRequest } from '@delegance/sdk';
import { getClient, failWith } from '../utils/client';
import { error, info, json, keyValue, success, table, warn, formatCurrency, formatDate } from '../utils/output';
import { cliInvocation } from '../utils/invocation';
import { coverageName } from '../utils/coverage-names';
import { SUPPORT_EMAIL } from '../support';

/** Payment amounts arrive in cents. Exported for tests. */
export function formatCents(cents: number, currency = 'usd'): string {
  return currency.toLowerCase() === 'usd' ? formatCurrency(cents / 100) : `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function readJsonFile(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
    return parsed;
  } catch (e) {
    error(`Could not read ${file}: ${(e as Error).message}`);
    process.exit(1);
  }
}

/** Print one bind outcome: a carrier checkout (tier A) or a broker review. */
export function describeBindResult(r: BindRequestResult): string[] {
  const lines: string[] = [];
  if (r.tier === 'A' && r.checkoutUrl) {
    lines.push(`Checkout opened with ${r.carrierName}. Pay on their page to bind:`);
    lines.push(r.checkoutUrl);
    lines.push("You'll get the policy by email; we attach it to your account automatically. It is not bound until the carrier confirms.");
    return lines;
  }
  if (r.tier === 'C' && r.reasons?.length) lines.push(`A broker reviews this one (${r.reasons.map((x) => x.replace(/_/g, ' ')).join(', ')}).`);
  lines.push(r.next);
  return lines;
}

/**
 * The self-directed placement acknowledgment shown before every bind (Terms
 * Section 9A), with the broker-review option. Exported for tests.
 */
export function selfDirectedAckLines(submissionId: string, offerId: string): string[] {
  return [
    'This is a self-directed placement: Delegance binds the coverage you chose and does not advise on whether it fits your needs (Terms Section 9A).',
    `Want a licensed broker to review it first? Run: ${cliInvocation()} bind ${submissionId} ${offerId} --broker-review`,
  ];
}

/** How to ask for a broker review instead of binding. Exported for tests. */
function brokerReviewMailto(submissionId: string, offerId: string): string {
  const subject = encodeURIComponent(`Broker review before bind: submission ${submissionId}, offer ${offerId}`);
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}`;
}

export function brokerReviewLines(submissionId: string, offerId: string): string[] {
  return [
    'Nothing was bound, and no review has been requested yet.',
    `To request a review by a licensed Delegance broker, send an email to ${SUPPORT_EMAIL}`,
    `naming submission ${submissionId} and offer ${offerId}: ${brokerReviewMailto(submissionId, offerId)}`,
    'Wait for the broker to reply before you bind. A reviewed placement is not self-directed.',
  ];
}

/** `--broker-review --json`: the same facts as one JSON document. Exported for tests. */
export function brokerReviewResult(submissionId: string, offerId: string) {
  return {
    bound: false,
    reviewRequested: false,
    submissionId,
    offerId,
    brokerReview: { email: SUPPORT_EMAIL, mailto: brokerReviewMailto(submissionId, offerId) },
    message: brokerReviewLines(submissionId, offerId),
  };
}

/** Exact dollars and cents: a lender's term is never rounded for display. */
function exactDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The financing lines for a bind, or none. Exported for tests. */
export function describeFinancing(f: BindRequestResult['financing']): string[] {
  if (!f || !f.available) return [];
  const lines: string[] = [];
  if (f.checkoutUrl) {
    lines.push(`Pay over time with ${f.lender}: ${f.checkoutUrl}`);
  } else {
    lines.push(`Financing with ${f.lender} opens once your broker confirms the final premium.`);
  }
  const t = f.terms;
  if (t && t.aprBps !== null && t.downPaymentCents !== null && t.installmentCents !== null && t.numberOfInstallments !== null) {
    lines.push(
      `Lender terms: ${(t.aprBps / 100).toFixed(2)}% APR, ${exactDollars(t.downPaymentCents)} down, `
      + `${t.numberOfInstallments} payments of ${exactDollars(t.installmentCents)}.`,
    );
  }
  lines.push(f.disclosure);
  return lines;
}

async function askCode(): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const answer = await inquirer.prompt([{
    type: 'input',
    name: 'code',
    message: 'Code from your email:',
    validate: (v: string) => /^\d{6}$/.test(v.trim()) || 'Enter the 6 digits from the email',
  }]);
  return String(answer.code).trim();
}

export function createBindCommand(): Command {
  return new Command('bind')
    .description('Bind one offer from "quote status": the carrier checkout when the carrier offers it, otherwise a broker review')
    .argument('<submissionId>', 'The quote submission id')
    .argument('<offerId>', 'The offer id from the quote table')
    .option('--attest', 'Confirm the application answers are accurate (asked interactively when omitted)')
    .option('--broker-review', 'Do not bind; ask a licensed broker to review this coverage first')
    .option('--step-up <id>', 'Finish an earlier attempt: the stepUpId the code email belongs to')
    .option('--code <code>', 'The 6-digit code from the email')
    .option('--json', 'Output as JSON')
    .action(async (submissionId: string, offerId: string, options) => {
      if (options.brokerReview) {
        if (options.json) json(brokerReviewResult(submissionId, offerId));
        else brokerReviewLines(submissionId, offerId).forEach((l) => info(l));
        return;
      }
      const client = getClient();
      const ack = selfDirectedAckLines(submissionId, offerId);
      // A software agent reads --json: it gets the same disclosure on stderr
      // BEFORE the bind (stdout stays one JSON document) and in the result.
      if (options.json) ack.forEach((l) => console.error(l));
      else ack.forEach((l) => info(l));
      let attest = options.attest === true;
      if (!attest && process.stdin.isTTY && !options.json) {
        const a = await inquirer.prompt([{
          type: 'confirm',
          name: 'ok',
          message: 'Are the answers on this application accurate? Binding relies on them.',
          default: false,
        }]);
        attest = a.ok === true;
        if (!attest) {
          warn(`Not bound. Fix the answers with "${cliInvocation()} quote start", then bind again.`);
          return;
        }
      }
      const spinner = options.json ? null : ora('Requesting the bind...').start();
      try {
        let r = await client.instantQuotes.bindWithStepUp(submissionId, offerId, {
          ...(attest ? { attest: true } : {}),
          ...(options.stepUp && options.code ? { stepUpId: String(options.stepUp), code: String(options.code) } : {}),
        });
        spinner?.stop();
        if ('stepUpRequired' in r) {
          const stepUpId = r.stepUpId;
          info(`We emailed a 6-digit code to ${r.sentTo}. It expires in 10 minutes.`);
          const code = options.code ? String(options.code) : await askCode();
          if (!code) {
            warn(`Finish with: ${cliInvocation()} bind ${submissionId} ${offerId} --attest --step-up ${stepUpId} --code <code>`);
            return;
          }
          r = await client.instantQuotes.bindWithStepUp(submissionId, offerId, { ...(attest ? { attest: true } : {}), stepUpId, code });
          if ('stepUpRequired' in r) {
            error('The code was not accepted. Run the command again for a new code.');
            process.exit(1);
          }
        }
        if (options.json) {
          json({ ...r, selfDirected: true, disclosure: ack[0] });
          return;
        }
        if (r.existing) warn(`A bind for this coverage is already open (${r.carrierName}). Showing it.`);
        else if (r.tier !== 'A') success(`Bind requested: ${r.carrierName} ${coverageName(r.coverage)}${r.premium === null ? '' : ` at ${formatCurrency(r.premium)}/yr`}`);
        keyValue({ 'Bind request': r.bindRequestId, Status: r.status });
        describeBindResult(r).forEach((l) => info(l));
        describeFinancing(r.financing).forEach((l) => info(l));
      } catch (err) {
        spinner?.stop();
        if (err instanceof DeleganceError && [400, 403, 409].includes(err.statusCode ?? 0)) {
          error(err.message);
          process.exit(1);
        }
        failWith('Bind failed', err);
      }
    });
}

/** Open and paid totals, in cents, from the payment requests. Exported for tests. */
export function summarizeBilling(payments: PaymentRequest[]): { openCents: number; paidCents: number; openCount: number } {
  let openCents = 0;
  let paidCents = 0;
  let openCount = 0;
  for (const p of payments) {
    if (p.payable) {
      openCents += p.amount;
      openCount += 1;
    } else if (['paid', 'succeeded', 'captured'].includes(p.status)) paidCents += p.amount;
  }
  return { openCents, paidCents, openCount };
}

export function createBillingCommand(): Command {
  return new Command('billing')
    .description('What you owe and what you paid: every premium payment request on the account')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const payments = await getClient().payments.list();
        const sum = summarizeBilling(payments);
        if (options.json) {
          json({ ...sum, payments });
          return;
        }
        if (payments.length === 0) {
          info('No payment requests yet. Carrier-billed policies are invoiced by the carrier directly.');
          return;
        }
        table(
          ['Payment', 'Amount', 'Status', 'Due', 'For'],
          payments.map((p) => [p.id, formatCents(p.amount, p.currency), p.status, p.dueDate ? formatDate(p.dueDate) : '-', p.description ?? '-']),
        );
        keyValue({ 'Open': `${formatCents(sum.openCents)} (${sum.openCount})`, 'Paid': formatCents(sum.paidCents) });
        if (sum.openCount > 0) info(`Pay one with: ${cliInvocation()} pay <paymentId>`);
      } catch (err) {
        failWith('API error', err);
      }
    });
}

export function createPayCommand(): Command {
  return new Command('pay')
    .description('Pay a premium: list payment requests, or get a checkout link for one')
    .argument('[paymentId]', 'Payment request to pay (omit to list them)')
    .option('--json', 'Output as JSON')
    .action(async (paymentId: string | undefined, options) => {
      const client = getClient();
      try {
        if (!paymentId) {
          const payments = await client.payments.list();
          if (options.json) {
            json(payments);
            return;
          }
          if (payments.length === 0) {
            info('No payment requests yet. One appears after a broker reviews your bind.');
            return;
          }
          table(
            ['Payment id', 'Amount', 'Description', 'Status', 'Due'],
            payments.map((p) => [p.id, formatCents(p.amount, p.currency), p.description ?? '', p.payable ? `${p.status} (payable)` : p.status, p.dueDate ? formatDate(p.dueDate) : '-']),
          );
          const next = payments.find((p) => p.payable);
          if (next) info(`Pay it: ${cliInvocation()} pay ${next.id}`);
          return;
        }
        const { checkoutUrl } = await client.payments.checkout(paymentId);
        if (options.json) json({ checkoutUrl });
        else {
          success('Open this link to pay with Stripe:');
          console.log(checkoutUrl);
        }
      } catch (err) {
        failWith('Payment failed', err);
      }
    });
}

/**
 * Human lines for a "bond quote" response. The v1 route reuses the MCP tool
 * service, whose `note` is written for a model ("share the finder link..."),
 * so it is never printed. Exported for tests.
 */
/** POSIX single-quote a value so a pasted command keeps &, $, spaces and quotes literal. */
export function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

export function bondStartLines(r: Record<string, unknown>, ctx: { state?: string } = {}): string[] {
  const out: string[] = [];
  const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));
  if (r.session_id) {
    out.push(`Bond quote started: ${str(r.session_id)}${r.bond_name ? ` (${str(r.bond_name)})` : ''}`);
    const qs = Array.isArray(r.questions) ? (r.questions as Record<string, unknown>[]) : [];
    if (qs.length) {
      out.push('Questions (answer by key in a JSON file):');
      qs.forEach((q) => {
        const opts = Array.isArray(q.options) && q.options.length ? ` [${(q.options as unknown[]).map(str).join(' | ')}]` : '';
        out.push(`  ${str(q.key)}: ${str(q.label)}${q.required ? ' (required)' : ''}${opts}`);
      });
    }
    out.push(`Answer with: ${cliInvocation()} bond answer ${str(r.session_id)} --answers answers.json`);
    return out;
  }
  if (Array.isArray(r.candidates) && r.candidates.length) {
    out.push('That name fits more than one bond. Rerun with the exact name:');
    // The quote API resolves 2-letter codes, FED and full state names; keep any non-blank value.
    const rawState = (ctx.state ?? '').trim();
    const state = !rawState ? null : /^[A-Za-z]{2}$/.test(rawState) ? rawState.toUpperCase() : shellQuote(rawState);
    (r.candidates as unknown[]).forEach((name) => out.push(state
      ? `  ${cliInvocation()} bond quote --state ${state} --bond ${shellQuote(str(name))}`
      // No state to name: print the value only, never a half-built command.
      : `  --bond ${shellQuote(str(name))}`));
    return out;
  }
  if (r.needsAmount) {
    out.push('This is a contract bond. Rerun with the bond amount in dollars: --bond-amount <amount>');
    return out;
  }
  if (r.route === 'underwriting_submission') {
    out.push(`At ${str(r.amount)} this is above the online limit of ${str(r.instantIssueLimit)}.`);
    out.push('A licensed Delegance broker submits it to surety markets. Underwriting will need:');
    (Array.isArray(r.submissionRequirements) ? (r.submissionRequirements as unknown[]) : []).forEach((item) => out.push(`  - ${str(item)}`));
    return out;
  }
  if (r.applyUrl) {
    out.push('This bond is not quoted in the terminal yet. Apply with the surety directly:');
    out.push(`  ${str(r.applyUrl)}`);
    return out;
  }
  const matches = Array.isArray(r.matches) ? (r.matches as Record<string, unknown>[]) : [];
  if (matches.length) {
    out.push('Bonds that match, with their apply links:');
    matches.forEach((m) => out.push(`  ${str(m.name)}\n    ${str(m.applyUrl)}`));
    return out;
  }
  out.push('No bond matched that name. Browse every bond by state:');
  out.push(`  ${str(r.filteredUrl ?? r.stateUrl ?? r.finderUrl)}`);
  return out;
}

export function createBondCommand(): Command {
  const bond = new Command('bond').alias('bonds').description('Surety bond quotes');

  bond
    .command('quote')
    .description('Start a bond quote and list its questions')
    .requiredOption('-s, --state <state>', 'Two-letter state, e.g. TX')
    .option('-b, --bond <name>', 'Bond name or keyword, e.g. "notary", "contractor license"')
    .option('--entity-id <id>', 'Exact bond id, when you have it')
    .option('--contract-amount <amount>', 'Contract value, for contract bonds')
    .option('--bond-amount <amount>', 'Bond penal sum')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const r = await getClient().bonds.start({
          state: String(options.state).toUpperCase(),
          bondName: options.bond,
          entityId: options.entityId,
          contractAmount: options.contractAmount,
          bondAmount: options.bondAmount,
        });
        if (options.json) {
          json(r);
          return;
        }
        bondStartLines(r as Record<string, unknown>, { state: String(options.state).toUpperCase() }).forEach((line) => console.log(line));
      } catch (err) {
        failWith('Bond quote failed', err);
      }
    });

  bond
    .command('answer <sessionId>')
    .description('Submit answers for a bond quote (starts pricing when complete)')
    .requiredOption('-a, --answers <file>', 'JSON file of answers keyed by question id')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, options) => {
      try {
        const r = await getClient().bonds.answer(sessionId, readJsonFile(options.answers));
        if (options.json) json(r);
        else {
          console.log(JSON.stringify(r, null, 2));
          info(`Check it: ${cliInvocation()} bond status ${sessionId}`);
        }
      } catch (err) {
        failWith('Could not submit the answers', err);
      }
    });

  bond
    .command('status <sessionId>')
    .description('Bond premium and the surety apply link')
    .option('--json', 'Output as JSON')
    .action(async (sessionId: string, options) => {
      try {
        const r = await getClient().bonds.status(sessionId);
        if (options.json) json(r);
        else {
          console.log(JSON.stringify(r, null, 2));
          if (r.apply_url) info(`Buy it on the surety's page: ${String(r.apply_url)}`);
        }
      } catch (err) {
        failWith('Could not read the bond quote', err);
      }
    });

  return bond;
}

export function createClaimCommand(): Command {
  const claim = new Command('claim').alias('claims').description('File and track claims');

  claim
    .command('file')
    .description('File a claim. The first time, accept the claims disclaimer in the portal')
    .option('-d, --description <text>', 'What happened (visible in shell history; prefer --description-file)')
    .option('--description-file <file>', 'Read what happened from a file, or - for stdin')
    .option('--date <yyyy-mm-dd>', 'When it happened')
    .option('--policy <id>', 'Policy id, if you know it')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      let description: string | undefined = options.description;
      if (options.descriptionFile) {
        try {
          description = fs.readFileSync(options.descriptionFile === '-' ? 0 : options.descriptionFile, 'utf8').trim();
        } catch (e) {
          error(`Could not read ${options.descriptionFile}: ${(e as Error).message}`);
          process.exit(1);
        }
      }
      if (!description) {
        error('Describe what happened with --description-file <file> (or --description).');
        process.exit(1);
      }
      try {
        const r = await getClient().claims.file({ description, incidentDate: options.date, policyId: options.policy });
        if (options.json) {
          json(r);
          return;
        }
        success(r.message);
        keyValue({ Claim: r.claimId, Status: r.status, Portal: r.portalUrl });
      } catch (err) {
        if (err instanceof DeleganceError && err.reason === 'gate_not_acknowledged') {
          error('Accept the claims disclaimer once in the portal, then file again. It cannot be accepted for you.');
          info(String(err.body?.portalUrl ?? ''));
          process.exit(1);
        }
        failWith('Could not file the claim', err);
      }
    });

  claim
    .command('list')
    .description('List claims')
    .option('-s, --status <status>', 'open, in_progress, or resolved')
    .option('-l, --limit <n>', 'Maximum results', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        const claims = await getClient().claims.list({ status: options.status, limit: Number(options.limit) || 20 });
        if (options.json) json(claims);
        else if (claims.length === 0) info('No claims.');
        else table(['Claim', 'Status', 'Incident', 'Summary', 'Last activity'], claims.map((c) => [c.claimId, c.status, c.incidentDate ?? '-', c.summary ?? '', formatDate(c.lastActivityAt)]));
      } catch (err) {
        failWith('Could not list claims', err);
      }
    });

  claim
    .command('status <claimId>')
    .description('One claim')
    .option('--json', 'Output as JSON')
    .action(async (claimId: string, options) => {
      try {
        const c = await getClient().claims.get(claimId);
        if (options.json) json(c);
        else keyValue({ Claim: c.claimId, Status: c.status, Incident: c.incidentDate ?? '-', Summary: c.summary ?? '', 'Last activity': formatDate(c.lastActivityAt) });
      } catch (err) {
        failWith('Could not read the claim', err);
      }
    });

  return claim;
}
