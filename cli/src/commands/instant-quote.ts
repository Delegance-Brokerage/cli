/**
 * Instant quotes from the terminal:
 *
 *   quote start  --coverage gl,wc [--answers file.json] [--demo] [--no-wait] [--replace]
 *   quote status <submissionId> [--wait]
 *
 * `start` asks the carriers' questions (or reads them from --answers), files
 * them, then waits for premiums and prints a table sorted cheapest bindable
 * first. `--demo` walks the same flow on canned bakery data and never calls
 * the server.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { DeleganceError, invalidAnswersDetails } from '@delegance/sdk';
import type { BrokerHandoffResult, InstantQuestion, InstantQuoteStatus, InvalidAnswer } from '@delegance/sdk';
import { getClient, failWith } from '../utils/client';
import { error, info, json, table, warn, formatCurrency, formatDateOnly } from '../utils/output';
import { cliCommand, cliInvocation } from '../utils/invocation';
import { coverageName, coverageNames } from '../utils/coverage-names';
import {
  bestPerCoverage,
  cheaperOfflinePerCoverage,
  checklistAnswers,
  coerceAnswer,
  formatKnown,
  isRequired,
  isStatement,
  isVisible,
  knownValue,
  parseCoverages,
  planQuestionRound,
  groupRowsByCoverage,
  quoteStatusWord,
  referralLines,
  refusedStatementLines,
  rowStatusWord,
  sortQuoteRows,
  stillWaiting,
  summarizeStatus,
  declineNote,
  formatOptionList,
  validateAnswers,
} from '../commerce/questions';
import type { QuoteRow } from '../commerce/questions';
import { wcMarketLines } from '../commerce/wc-market';
import { DEMO_BUSINESS, DEMO_QUESTIONS, DEMO_SHORT_LABELS, DEMO_STATUS } from '../commerce/demo';

/**
 * A 409 from the active-request guard says what is already with carriers and
 * the two ways forward. Returns the two lines to print, or null for any other
 * error. The v1 route puts the guard's code in `message`.
 *
 * The replace command has to fit the caller. `quote start --replace` mints a
 * fresh session AND submits with replace, so it only re-quotes when it is the
 * one filing the answers. A caller in the two-step flow (`quote start --json`,
 * then `quote submit`) passes `submit`, and the hint names the submit command,
 * because a bare `quote start --replace` there only sends `fresh` and the next
 * submit gets the same 409.
 */
export interface ActiveRequestHintContext {
  /** The answers file the caller used, carried into the printed command. */
  answersFile?: string;
  /** Set when the caller is `quote submit <id>`. */
  submit?: { submissionId: string; sessionVersion: string };
}

function shellArg(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, '\'\\\'\'')}'`;
}

export function activeRequestLines(
  err: unknown,
  coverageFlag: string,
  ctx: ActiveRequestHintContext = {},
): string[] | null {
  if (!(err instanceof DeleganceError) || err.statusCode !== 409 || !err.body) return null;
  const { body } = err;
  const code = body.message;
  const answersArg = ctx.answersFile ? ` --answers ${shellArg(ctx.answersFile)}` : '';
  // One command that starts a fresh session and submits it with replace.
  const requote = `${cliInvocation()} quote start --coverage ${coverageFlag}${answersArg} --replace`;
  const replaceCmd = ctx.submit
    ? `${cliInvocation()} quote submit ${shellArg(ctx.submit.submissionId)} --session-version ${shellArg(ctx.submit.sessionVersion)}`
      + ` --answers ${ctx.answersFile ? shellArg(ctx.answersFile) : '<file>'} --replace`
    : requote;
  if (code === 'active_request_exists') {
    const active = Array.isArray(body.active) ? (body.active as Record<string, unknown>[]) : [];
    const first = active[0];
    const id = typeof first?.submissionId === 'string' ? first.submissionId : null;
    const carriers = Array.isArray(first?.carriers)
      ? (first.carriers as { carrierId?: string; state?: string }[])
        .map((c) => `${c.carrierId}${c.state ? ` (${c.state.toLowerCase()})` : ''}`)
        .join(', ')
      : '';
    return [
      `Already with carriers${id ? `: ${id}` : ''}${carriers ? `, ${carriers}` : ''}.`,
      `Check it: ${id ? `${cliInvocation()} quote status ${id}` : `${cliInvocation()} quote status <id>`}   Replace it: ${replaceCmd}`,
    ];
  }
  if (code === 'replace_conflict') {
    const carrier = typeof body.carrier === 'string' ? body.carrier : 'A carrier';
    return [
      `Cannot replace: ${carrier} has a bind in progress or bound on the earlier request.`,
      'Reply to your quote confirmation email and a broker will sort it out.',
    ];
  }
  if (code === 'answers_changed_requote_required') {
    // This submission is already in market, so re-submitting it (even with
    // replace) records a revision and answers this same 409. Re-quoting needs
    // a fresh session, which only the start form makes.
    return ['Carriers are quoting your earlier answers.', `Re-quote with the new answers: ${requote}`];
  }
  return null;
}

function invalidReasonText(q: InvalidAnswer): string {
  const { detail } = q as InvalidAnswer & { detail?: string };
  if (typeof detail === 'string' && detail) return detail;
  switch (q.reason) {
    case 'option_not_offered':
      return q.allowed && q.allowed.length > 0
        ? `not one of the options. Use one of: ${formatOptionList(q.allowed)}`
        : 'not one of the options this question offers';
    case 'bad_date':
      return 'not a full date. Use YYYY-MM-DD, for example 2024-03-15';
    case 'bad_number':
      return 'not a number. Use digits only, for example 250000';
    default:
      return 'could not be used. Check the answer and try again';
  }
}

/**
 * A 422 `uw_answers_invalid`: nothing reached a carrier because required
 * answers are in a form no carrier accepts. Returns one line per question,
 * named by its label, then the server's hint. Null for any other error.
 * Exported for tests.
 */
export function invalidAnswerLines(err: unknown): string[] | null {
  const details = invalidAnswersDetails(err);
  if (!details) return null;
  const lines = ['Some answers need fixing before the carriers can quote:'];
  if (details.questions.length === 0) {
    lines.push('  - The server did not say which answers. Check dates (YYYY-MM-DD) and choices, then submit again.');
  }
  details.questions.forEach((q) => lines.push(`  - ${q.label || q.id}: ${invalidReasonText(q)}`));
  if (details.hint) lines.push(details.hint);
  return lines;
}

export type AnswerMode = 'prompt' | 'suggested' | 'file' | 'print_questions' | 'needs_answers';

/**
 * How `quote start` gets its answers. Without a terminal an inquirer prompt
 * never resolves: Node empties the event loop and exits 0 with no output, which
 * reads as success. So a demo falls back to its suggested answers and a real
 * quote refuses. Exported for tests.
 */
export function answerMode(o: { demo: boolean; hasAnswersFile: boolean; json: boolean; isTTY: boolean }): AnswerMode {
  if (o.hasAnswersFile) return 'file';
  if (o.demo) return o.json || !o.isTTY ? 'suggested' : 'prompt';
  if (o.json) return 'print_questions';
  return o.isTTY ? 'prompt' : 'needs_answers';
}

/** Every visible question answered from its prefill, in order. Exported for tests. */
export function suggestedAnswers(questions: InstantQuestion[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    // eslint-disable-next-line no-continue -- skip hidden follow-ups
    if (!isVisible(q, answers) || q.prefill === undefined || q.prefill === null) continue;
    const c = coerceAnswer(q, String(q.prefill));
    if (c.ok && c.value !== undefined) answers[q.id] = c.value;
  }
  return answers;
}

const isInteractive = (): boolean => Boolean(process.stdin.isTTY && process.stdout.isTTY);

/* eslint-disable no-await-in-loop -- prompts run one screen at a time */
export interface AskStats {
  asked: number;
  checklist: number;
  prefilled: number;
  suggestedConfirmed: number;
  suggestedChanged: number;
}

/** One prompt for a question no source answered (or whose value the insured rejected). */
async function askOne(q: InstantQuestion, answers: Record<string, unknown>, fallback?: unknown): Promise<void> {
  const required = isRequired(q, answers);
  const label = `${q.label}${required ? '' : chalk.dim(' (optional)')}`;
  let prompt: Record<string, unknown>;
  if (isStatement(q)) {
    // A declaration to accept, shown whole. No default: a carrier that
    // publishes one quotes only after a yes.
    const carriers = ((q.statement as { carriers?: unknown }).carriers as string[] | undefined) ?? [];
    console.log(`\n${chalk.bold(carriers.length ? `Statement from ${carriers.join(', ')}` : 'Carrier statement')}\n${q.label}\n`);
    prompt = {
      type: 'list',
      name: 'v',
      message: `Do you accept this statement?${carriers.length ? ` ${chalk.dim(`(No removes ${carriers.join(', ')} from this quote)`)}` : ''}`,
      choices: [{ name: 'Yes, I accept', value: 'yes' }, { name: 'No', value: 'no' }],
    };
  } else if (q.type === 'yes_no') {
    prompt = { type: 'list', name: 'v', message: label, choices: [{ name: 'Yes', value: 'yes' }, { name: 'No', value: 'no' }], default: fallback };
  } else if (q.type === 'select' && q.options?.length) {
    prompt = { type: 'list', name: 'v', message: label, choices: q.options.map((o) => ({ name: o.label, value: o.value })), default: fallback };
  } else {
    prompt = {
      type: 'input',
      name: 'v',
      message: label,
      default: fallback === undefined || fallback === null ? undefined : String(fallback),
      validate: (v: string) => {
        if (!v && required) return 'Required';
        const c = coerceAnswer(q, v);
        return c.ok || c.message;
      },
    };
  }
  const { v } = await inquirer.prompt([prompt as any]);
  const c = coerceAnswer(q, v);
  if (c.ok && c.value !== undefined) answers[q.id] = c.value;
}

/**
 * Ask the carriers' questions in as few screens as possible:
 *   1. one confirm screen for every value a source already holds,
 *   2. one checklist for the required yes/no questions ("check what is true"),
 *   3. one prompt each for the remaining required questions.
 * Rounds repeat while answers reveal new showIf follow-ups. A suggestion
 * enters the answers only after the insured leaves it checked.
 */
export async function askQuestions(
  questions: InstantQuestion[],
  // Filled in place, so a caller that is interrupted still holds what was answered.
  answers: Record<string, unknown> = {},
): Promise<{ answers: Record<string, unknown>; stats: AskStats }> {
  const handled = new Set<string>();
  const stats: AskStats = { asked: 0, checklist: 0, prefilled: 0, suggestedConfirmed: 0, suggestedChanged: 0 };
  for (;;) {
    const round = planQuestionRound(questions, answers, handled);
    if (round.confirm.length + round.checklist.length + round.ask.length === 0) break;

    if (round.confirm.length) {
      const { keep } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'keep',
          message: 'We already have these answers. Uncheck any that are wrong, then press Enter:',
          pageSize: 20,
          choices: round.confirm.map((q) => {
            const k = knownValue(q)!;
            return { name: `${q.label}: ${chalk.bold(formatKnown(q, k.value))} ${chalk.dim(`(${k.source})`)}`, value: q.id, checked: true };
          }),
        } as any,
      ]);
      const kept = new Set<string>(keep);
      for (const q of round.confirm) {
        handled.add(q.id);
        const k = knownValue(q)!;
        const kc = kept.has(q.id) ? coerceAnswer(q, k.value) : null;
        if (kc && kc.ok && kc.value !== undefined) {
          answers[q.id] = kc.value;
          if (k.kind === 'prefill') stats.prefilled += 1;
          else stats.suggestedConfirmed += 1;
        } else {
          // Rejected, or the stored value does not fit the question: ask it.
          if (k.kind === 'suggested') stats.suggestedChanged += 1;
          stats.asked += 1;
          await askOne(q, answers);
        }
      }
    }

    if (round.checklist.length) {
      const { yes } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'yes',
          message: `Check every statement that is TRUE for your business (${round.checklist.length}). Unchecked means No:`,
          pageSize: 20,
          choices: round.checklist.map((q) => ({ name: q.label, value: q.id })),
        } as any,
      ]);
      const yn = checklistAnswers(round.checklist, yes);
      const yesCount = Object.values(yn).filter((v) => v === 'yes').length;
      const { ok } = await inquirer.prompt([
        { type: 'confirm', name: 'ok', message: `Yes to ${yesCount}, No to ${round.checklist.length - yesCount}. Correct?`, default: true } as any,
      ]);
      if (ok) {
        Object.assign(answers, yn);
        round.checklist.forEach((q) => handled.add(q.id));
        stats.checklist += round.checklist.length;
      }
      // Not confirmed: the same checklist comes back next round.
    }

    for (const q of round.ask) {
      handled.add(q.id);
      stats.asked += 1;
      await askOne(q, answers);
    }
  }
  return { answers, stats };
}

/* eslint-enable no-await-in-loop */

/**
 * What the CLI prints after a no-carrier request reaches a broker. Plain
 * sentences, the status command last. Exported for tests.
 */
export function handoffLines(r: Pick<BrokerHandoffResult, 'submissionId' | 'unansweredRequired' | 'alreadyHandedOff'>): string[] {
  const lines = [
    r.alreadyHandedOff
      ? 'A Delegance broker already has this request.'
      : 'A Delegance broker has this request and will place it with a market that quotes by hand.',
  ];
  if (!r.alreadyHandedOff && r.unansweredRequired > 0) {
    lines.push(`The broker will email you for the ${r.unansweredRequired} answer(s) still missing.`);
  }
  lines.push(`Check it: ${cliInvocation()} quote status ${r.submissionId}`);
  return lines;
}

/**
 * A `no_carriers` result used to end here with "reply to the confirmation
 * email". It now asks the ACORD questions a broker needs, then hands the
 * request to a broker, who places it with a non-instant market. Ctrl-C stops
 * the questions and sends what was answered. Without a terminal (or with
 * --json) nothing can be asked, so the request goes to the broker as is.
 */
export async function runBrokerHandoff(
  submissionId: string,
  instantAnswers: Record<string, unknown>,
  opts: { json: boolean; answersFile?: string },
): Promise<void> {
  const client = getClient();
  const say = (l: string): void => (opts.json ? console.error(l) : info(l));
  let plan;
  try {
    plan = await client.instantQuotes.brokerHandoffQuestions(submissionId, instantAnswers);
  } catch (err) {
    if (err instanceof DeleganceError && err.statusCode === 503) {
      say('A broker can still market it: reply to the confirmation email, or start in the portal.');
      return;
    }
    failWith('Could not load the broker questions', err);
  }
  if (plan.alreadyHandedOff) {
    const lines = handoffLines({ submissionId, unansweredRequired: 0, alreadyHandedOff: true });
    if (opts.json) json({ submissionId, status: 'broker_review', alreadyHandedOff: true, brokerTaskId: plan.brokerTaskId ?? null });
    else lines.forEach((l) => info(l));
    return;
  }

  let answers: Record<string, unknown> = {};
  let complete = true;
  // One key for this run: a repeat of the same handoff lands on the same request.
  const idempotencyKey = randomUUID();
  let inFlight: Promise<void> | null = null;
  if (opts.answersFile) {
    try {
      const provided = JSON.parse(fs.readFileSync(opts.answersFile, 'utf8'));
      const checked = validateAnswers(plan.questions, provided);
      if (checked.problems.length) {
        error('Some answers need fixing:');
        checked.problems.forEach((p) => console.log(`  - ${p}`));
        process.exit(1);
      }
      answers = checked.answers;
    } catch (e) {
      error(`Could not read ${opts.answersFile}: ${(e as Error).message}`);
      process.exit(1);
    }
  } else if (!opts.json && isInteractive() && plan.questions.length > 0) {
    info(`A broker can place ${coverageNames(plan.coverages)} with a market that quotes by hand. ${plan.questions.length} application question(s) left.`);
    info('Press Ctrl-C to stop at any point; what you have answered goes to the broker.');
    // Ctrl-C mid-question: inquirer never settles the open prompt, so the
    // handler sends what was answered and exits. `send` is single-flight, so a
    // prompt that also rejects cannot start a second request.
    const onInterrupt = (): void => {
      complete = false;
      void send().then(() => process.exit(0));
    };
    process.once('SIGINT', onInterrupt);
    try {
      await askQuestions(plan.questions, answers);
    } catch {
      // A closed prompt (Ctrl-D, a lost terminal) is a stop, not a failure.
      complete = false;
    } finally {
      process.removeListener('SIGINT', onInterrupt);
    }
  } else {
    complete = plan.questions.length === 0;
  }
  await send();

  function send(): Promise<void> {
    inFlight ??= sendHandoff(submissionId, { answers, instantAnswers, complete }, idempotencyKey, opts.json);
    return inFlight;
  }
}

async function sendHandoff(
  submissionId: string,
  input: { answers: Record<string, unknown>; instantAnswers: Record<string, unknown>; complete: boolean },
  idempotencyKey: string,
  asJson: boolean,
): Promise<void> {
  const spinner = asJson ? null : ora('Sending it to a broker...').start();
  try {
    const result = await getClient().instantQuotes.brokerHandoff(submissionId, input, { idempotencyKey });
    spinner?.succeed('Sent to a broker.');
    if (asJson) json(result);
    else handoffLines(result).forEach((l) => info(l));
  } catch (err) {
    spinner?.fail('Could not reach a broker');
    console.error(`Try again: ${cliInvocation()} quote handoff ${submissionId}`);
    failWith('API error', err);
  }
}

/**
 * Carriers `quote start` listed that the submit did not send to, one line
 * each ("CNA: needs building area, construction type"), plus how to bring a
 * needs-info carrier back. Empty on an older server. Exported for tests.
 */
export function withheldLines(
  status: Pick<InstantQuoteStatus, 'withheldCarriers' | 'coverages'>
    & { brokerReview?: unknown; awaitingBrokerReviewCount?: number; carrierQuotes?: InstantQuoteStatus['carrierQuotes'] },
): string[] {
  const withheld = status.withheldCarriers ?? [];
  if (withheld.length === 0) return [];
  // A newer server also lists each withheld carrier as a table row with its
  // reason; print the reason once.
  const inTable = new Set((status.carrierQuotes ?? [])
    .filter((q) => (q as { withheld?: boolean }).withheld === true)
    .map((q) => q.carrierId.toUpperCase()));
  const listed = withheld.filter((w) => !inTable.has(w.carrierId.toUpperCase()));
  const lines = listed.length > 0 ? ['Not sent to:', ...listed.map((w) => `  ${w.message}`)] : [];
  // Once a broker has the request, `--replace` would supersede what they were
  // just handed, so the re-quote command is not offered.
  const withBroker = !!status.brokerReview || (status.awaitingBrokerReviewCount ?? 0) > 0;
  if (!withBroker && withheld.some((w) => w.status === 'needs_info')) {
    lines.push(requoteLine(status.coverages.join(',')));
  }
  return lines;
}

function requoteLine(coverage: string): string {
  const flag = coverage ? ` --coverage ${coverage}` : '';
  return `Run the quote again with ${cliCommand(`quote start${flag} --replace`)} and answer what is missing.`;
}

/** Name the value that would bring back each carrier a data floor removed. Exported for tests. */
export function floorDropLines(
  failures: { carrierId: string; reason: string; missing?: string }[] | undefined,
  coverage: string,
): string[] {
  // A carrier also excluded for another reason (a contract requirement) cannot
  // come back by answering a question, so it is not offered as fixable here.
  // Missing-answer drops are fixable and a needs_review note keeps the carrier
  // in the market, so neither excludes it.
  const excluded = new Set((failures ?? [])
    .filter((f) => !f.reason.startsWith('requirement_floor:')
      && !f.reason.startsWith('missing:')
      && !f.reason.startsWith('requirement:needs_review:'))
    .map((f) => f.carrierId.toUpperCase()));
  const byCarrier = new Map<string, string[]>();
  for (const f of failures ?? []) {
    // eslint-disable-next-line no-continue -- only floor drops name a value
    if (!f.reason.startsWith('requirement_floor:') || !f.missing || excluded.has(f.carrierId.toUpperCase())) continue;
    const list = byCarrier.get(f.carrierId) ?? [];
    if (!list.includes(f.missing)) list.push(f.missing);
    byCarrier.set(f.carrierId, list);
  }
  if (byCarrier.size === 0) return [];
  // No coverage (the scripted `quote submit` does not know it, and a broker
  // handoff follows a no-carrier submit): no `--replace` command, because one
  // without the right coverage, or one that supersedes the handoff, does harm.
  return [
    'Not sent to these carriers, because a fact they need is missing:',
    ...[...byCarrier.entries()].map(([carrier, missing]) => `  - ${carrier}: needs ${missing.join('; ')}`),
    ...(coverage ? [requoteLine(coverage)] : []),
  ];
}

function printFloorDrops(failures: { carrierId: string; reason: string; missing?: string }[] | undefined, coverage: string): void {
  const lines = floorDropLines(failures, coverage);
  if (lines.length === 0) return;
  const [head, ...rest] = lines;
  warn(head);
  rest.forEach((l) => (l.startsWith('  - ') ? console.log(l) : info(l)));
}

/** The agent tip that closes the demo. Agent-neutral on purpose. */
export const AGENT_TIP =
  'Tip: your AI agent can do this for you. Open Claude Code, Codex, Gemini CLI or any coding agent in a folder with your insurance documents and ask it to get you a quote with npx -y @delegance/cli.';

const premiumText = (n: number | null): string => (n === null ? '-' : formatCurrency(n));
const deductibleText = (n: number | null): string => (n === null ? '-' : n === 0 ? 'None' : formatCurrency(n));

/** The "Best price you can bind now" block: one line per coverage with a bindable price. Exported for tests. */
export function bestPriceLines(best: QuoteRow[]): string[] {
  if (best.length === 0) return [];
  const names = best.map((r) => coverageName(r.coverage));
  const nameW = Math.max(...names.map((n) => n.length));
  const carrierW = Math.max(...best.map((r) => r.carrier.length));
  return [
    'Best price you can bind now:',
    ...best.map((r, i) => `  ${names[i].padEnd(nameW)}   ${r.carrier.padEnd(carrierW)}   ${formatCurrency(r.premium)}/yr`),
  ];
}

/**
 * One line per coverage where a quote that cannot be bound online is cheaper
 * than the best bindable one (or is the only price). The coverage is named
 * only when more than one coverage is shown. Exported for tests.
 */
export function cheaperOfflineLines(cheaper: QuoteRow[], best: QuoteRow[]): string[] {
  const coverages = new Set([...best, ...cheaper].map((r) => coverageName(r.coverage)));
  const bindable = new Set(best.map((r) => coverageName(r.coverage)));
  return cheaper.map((r) => {
    const name = coverageName(r.coverage);
    const label = bindable.has(name) ? 'Cheaper' : 'Quoted';
    const scope = coverages.size > 1 ? ` ${name}` : '';
    return `${label}${scope}: ${r.carrier} ${formatCurrency(r.premium)}/yr, bind through Delegance`;
  });
}

/** The bind command(s) for a real quote: one per coverage best. Exported for tests. */
export function bindHintLines(submissionId: string, best: QuoteRow[]): string[] {
  if (best.length === 1) return [`Bind it: ${cliCommand(`bind ${submissionId} ${best[0].opportunityId}`)}`];
  return best.map((r) => `Bind ${coverageName(r.coverage)}: ${cliCommand(`bind ${submissionId} ${r.opportunityId}`)}`);
}

/** The lines that close a demo: what to run on a real quote, the DEMO notice, signup, the agent tip. Exported for tests. */
export function demoClosingLines(best: QuoteRow[]): string[] {
  const example = best[0] ? `   (e.g. bind ... ${best[0].opportunityId})` : '';
  return [
    `Next, on a real quote: ${cliCommand('bind <quote id> <offer>')}${example}`,
    'DEMO: sample premiums, nothing went to a carrier.',
    `Get real quotes: ${cliCommand('signup')}`,
    AGENT_TIP,
  ];
}

/**
 * Print the results (spec visual treatment): the cheapest bindable offer per
 * coverage, then every offer grouped by coverage, then what to run next.
 * Prices are never compared across coverages.
 */
export function printQuoteTable(status: InstantQuoteStatus, opts: { demo?: boolean; showStartDate?: boolean } = {}): void {
  const rows = groupRowsByCoverage(sortQuoteRows(status.carrierQuotes));
  if (rows.length === 0) {
    if (status.brokerReview) {
      info(`A broker has this request (${status.brokerReview.status.replace(/_/g, ' ')}). They place it by hand and email you with quotes or questions.`);
      withheldLines(status).forEach((l) => console.log(l));
      return;
    }
    warn('No carrier offers yet.');
    if (status.awaitingBrokerReviewCount > 0) info(`${status.awaitingBrokerReviewCount} quote(s) are with a broker for review.`);
    withheldLines(status).forEach((l) => console.log(l));
    return;
  }
  const best = bestPerCoverage(rows);
  const bestIds = new Set(best.map((r) => r.opportunityId));
  const {effectiveDate} = (status as InstantQuoteStatus & { effectiveDate?: string | null });
  console.log();
  if (effectiveDate && opts.showStartDate !== false) {
    console.log(`Coverage starts ${formatDateOnly(effectiveDate)}`);
  }
  const bestLines = bestPriceLines(best);
  const cheaperLines = cheaperOfflineLines(cheaperOfflinePerCoverage(rows, best), best);
  if (bestLines.length) {
    console.log(chalk.bold(bestLines[0]));
    bestLines.slice(1).forEach((l) => console.log(l));
  }
  cheaperLines.forEach((l) => console.log(l));
  if (bestLines.length || cheaperLines.length) console.log();
  table(
    ['Carrier', 'Coverage', 'Premium/yr', 'Limits', 'Deductible', 'Status', 'Offer'],
    rows.map((r) => {
      const cells = [
        r.carrier,
        coverageName(r.coverage),
        premiumText(r.premium),
        r.limits ?? '-',
        deductibleText(r.deductible),
        rowStatusWord(r),
        r.opportunityId || '-',
      ];
      return bestIds.has(r.opportunityId) ? cells.map((c) => chalk.bold(c)) : cells;
    }),
    { compact: true },
  );
  const reasons = rows.filter((r) => r.message);
  if (reasons.length) {
    console.log();
    reasons.forEach((r) => console.log(`${r.carrier} (${quoteStatusWord(r.status)}): ${r.message}`));
  }
  const withheld = withheldLines(status);
  if (withheld.length) {
    console.log();
    withheld.forEach((l) => console.log(l));
  }
  console.log();
  console.log(chalk.dim(`${summarizeStatus(status)}.`));
  const note = declineNote(status);
  if (note) console.log(chalk.dim(note));
  referralLines(status).forEach((l) => console.log(l));
  if (opts.demo) {
    const [next, notice, signup, tip] = demoClosingLines(best);
    console.log(chalk.green(next));
    console.log(chalk.yellow(notice));
    console.log(chalk.yellow(signup));
    console.log(chalk.dim(tip));
    return;
  }
  bindHintLines(status.submissionId, best).forEach((l) => console.log(chalk.green(l)));
}

/** The sample answers a non-interactive demo assumed, plus the start date. Exported for tests. */
export function demoAnswerLines(answers: Record<string, unknown>, effectiveDate: string | null): string[] {
  const pairs: [string, string][] = [];
  for (const q of DEMO_QUESTIONS) {
    // eslint-disable-next-line no-continue -- only what the demo actually assumed
    if (answers[q.id] === undefined) continue;
    const v = answers[q.id];
    const shown = q.type === 'currency' && typeof v === 'number' ? formatCurrency(v) : formatKnown(q, v);
    pairs.push([DEMO_SHORT_LABELS[q.id] ?? q.label, shown]);
  }
  if (effectiveDate) pairs.push(['Coverage starts', formatDateOnly(effectiveDate)]);
  const w = Math.max(...pairs.map(([k]) => k.length));
  return ['Sample answers (a real quote asks you these):', ...pairs.map(([k, v]) => `  ${k.padEnd(w)}   ${v}`)];
}

/** The `--demo` walkthrough on canned bakery data. Exported for tests. */
export async function runDemo(asJson: boolean, answersFile?: string): Promise<void> {
  // stderr in --json mode so stdout stays parseable.
  (asJson ? console.error : console.log)(chalk.yellow(`DEMO quote for ${DEMO_BUSINESS}. Nothing leaves this machine.`));
  let printedStart = false;
  if (answersFile) {
    let provided: Record<string, unknown>;
    try {
      provided = JSON.parse(fs.readFileSync(answersFile, 'utf8'));
    } catch (e) {
      error(`Could not read ${answersFile}: ${(e as Error).message}`);
      process.exit(1);
    }
    const { problems } = validateAnswers(DEMO_QUESTIONS, provided);
    if (problems.length) {
      problems.forEach((p) => error(p));
      process.exit(1);
    }
  } else {
    const mode = answerMode({ demo: true, hasAnswersFile: false, json: asJson, isTTY: isInteractive() });
    if (mode === 'prompt') await askQuestions(DEMO_QUESTIONS);
    else {
      const assumed = suggestedAnswers(DEMO_QUESTIONS);
      if (!asJson) {
        demoAnswerLines(assumed, DEMO_STATUS.effectiveDate).forEach((l) => console.log(l));
        printedStart = true;
      }
    }
  }
  // Without a terminal ora would print a stray "- Asking..." line; only the result line matters there.
  const spinner = asJson ? null : ora('Asking carriers (demo)...');
  if (spinner && process.stderr.isTTY) spinner.start();
  await new Promise((resolve) => setTimeout(resolve, asJson ? 0 : 1200));
  spinner?.succeed('4 carriers answered (demo)');
  if (asJson) json({ demo: true, ...DEMO_STATUS });
  else printQuoteTable(DEMO_STATUS, { demo: true, showStartDate: !printedStart });
}

export function addInstantQuoteCommands(quote: Command): void {
  quote
    .command('start')
    .description('Get instant quotes from real carriers: answers the questions, files them, waits for premiums')
    .option('-c, --coverage <list>', 'Coverages, comma-separated: gl, wc, bop, cyber, pl (E&O), auto, property, umbrella', 'gl')
    .option('-a, --answers <file>', 'JSON file of answers keyed by question id (skips the prompts)')
    .option('--demo', 'Walk the flow on sample data; nothing is sent anywhere')
    .option('--no-wait', 'File the quote and exit; check later with "quote status"')
    .option('--timeout <minutes>', 'How long to wait for premiums', '10')
    .option('--replace', 'Close the request already with carriers for this coverage and re-quote')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      if (options.demo) {
        await runDemo(!!options.json, options.answers);
        return;
      }
      const coverages = parseCoverages(String(options.coverage));
      if (coverages.length === 0) {
        error('Name at least one coverage with --coverage');
        process.exit(1);
      }
      const client = getClient();

      const spinner = ora('Checking which carriers can quote...').start();
      let session;
      try {
        session = await client.instantQuotes.start(coverages, options.replace ? { fresh: true } : {});
        spinner.succeed(
          `${session.eligibleCarriers.length} carrier(s) can quote: ${session.eligibleCarriers.map((c) => c.name).join(', ') || 'broker review only'}`,
        );
      } catch (err) {
        spinner.fail('Could not start the quote');
        failWith('API error', err);
      }
      // Workers' comp by state (monopolistic states get no private WC price).
      wcMarketLines(session).forEach((l) => (options.json ? console.error(l) : info(l)));

      let answers: Record<string, unknown>;
      if (options.answers) {
        let provided: Record<string, unknown>;
        try {
          provided = JSON.parse(fs.readFileSync(options.answers, 'utf8'));
        } catch (e) {
          error(`Could not read ${options.answers}: ${(e as Error).message}`);
          process.exit(1);
        }
        const checked = validateAnswers(session.questions, provided);
        if (checked.problems.length) {
          error('Some answers need fixing:');
          checked.problems.forEach((p) => console.log(`  - ${p}`));
          info(`Question ids: ${session.questions.map((q) => q.id).join(', ')}`);
          process.exit(1);
        }
        answers = checked.answers;
        // stderr under --json, so stdout stays parseable.
        refusedStatementLines(session.questions, answers).forEach((l) => (options.json ? console.error(l) : warn(l)));
      } else if (answerMode({ demo: false, hasAnswersFile: false, json: !!options.json, isTTY: isInteractive() }) === 'needs_answers') {
        error('No terminal to ask the questions in.');
        info(`Re-run with --answers <file.json>, or with --json to print the questions. Session: ${session.submissionId}`);
        process.exit(1);
      } else if (options.json) {
        // Machine mode without answers: print the questions and stop.
        json({ submissionId: session.submissionId, sessionVersion: session.sessionVersion, questions: session.questions });
        return;
      } else {
        const asked = await askQuestions(session.questions);
        answers = asked.answers;
        const s = asked.stats;
        info(`${s.prefilled + s.suggestedConfirmed} answer(s) confirmed from what we have, ${s.checklist} on the checklist, ${s.asked} asked.`);
      }

      const submitSpinner = ora('Sending your answers to the carriers...').start();
      let submitted;
      try {
        submitted = await client.instantQuotes.submit({
          submissionId: session.submissionId,
          sessionVersion: session.sessionVersion,
          answers,
          ...(options.replace ? { replace: true } : {}),
        });
      } catch (err) {
        const guardLines = activeRequestLines(err, String(options.coverage), { answersFile: options.answers });
        if (guardLines) {
          submitSpinner.fail('Nothing was sent.');
          // stderr, so --json stdout stays parseable.
          guardLines.forEach((l) => (options.json ? console.error(l) : info(l)));
          process.exit(1);
        }
        const answerLines = invalidAnswerLines(err);
        if (answerLines) {
          submitSpinner.fail('Nothing was sent.');
          answerLines.forEach((l) => console.error(l));
          process.exit(1);
        }
        submitSpinner.fail('Submit failed');
        // The request may have reached the carriers. Check before retrying.
        // stderr, so --json stdout stays parseable.
        console.error(`Before trying again, check whether it went through: ${cliInvocation()} quote status ${session.submissionId}`);
        failWith('API error', err);
      }
      if (submitted.status === 'no_carriers') {
        if (options.json) console.error('No carrier could take this one instantly. Sending it to a broker.');
        else submitSpinner.warn('No carrier could take this one instantly.');
        // A broker handoff follows: no `--replace` hint (it would supersede it).
        if (!options.json) printFloorDrops(submitted.partialFailures, '');
        await runBrokerHandoff(session.submissionId, answers, { json: !!options.json });
        return;
      }
      if (options.json && (submitted.status !== 'submitted' || options.wait === false)) {
        json({ submissionId: session.submissionId, ...submitted });
        return;
      }
      if (submitted.status === 'acord_pending') {
        submitSpinner.succeed('Sent to a broker: these coverages need a person, not an instant quote.');
        info(`Track it with: ${cliInvocation()} quote status ${session.submissionId}`);
        return;
      }
      submitSpinner.succeed(`Filed with ${submitted.quotes.filter((q) => q.status === 'submitted').length} carrier(s).`);
      printFloorDrops(submitted.partialFailures, String(options.coverage));
      if (submitted.replaceNotice && !options.json) info(submitted.replaceNotice);

      if (options.wait === false) {
        info(`Check premiums with: ${cliInvocation()} quote status ${session.submissionId} --wait`);
        return;
      }
      await waitAndPrint(session.submissionId, Number(options.timeout) * 60_000 || 600_000, !!options.json);
    });

  quote
    .command('submit <submissionId>')
    .description('File answers for a session started with "quote start --json" (scripted flow)')
    .requiredOption('--session-version <version>', 'sessionVersion from "quote start --json"')
    .requiredOption('-a, --answers <file>', 'JSON file of answers keyed by question id')
    .option('--idempotency-key <key>', 'Reuse on a retry so the same submission is not filed twice')
    .option('--replace', 'Close the request already with carriers for this coverage and re-quote')
    .option('--no-wait', 'Exit after filing')
    .option('--timeout <minutes>', 'How long to wait for premiums', '10')
    .option('--json', 'Output as JSON')
    .action(async (submissionId: string, options) => {
      let answers: Record<string, unknown>;
      try {
        answers = JSON.parse(fs.readFileSync(options.answers, 'utf8'));
      } catch (e) {
        error(`Could not read ${options.answers}: ${(e as Error).message}`);
        process.exit(1);
      }
      try {
        const submitted = await getClient().instantQuotes.submit(
          { submissionId, sessionVersion: options.sessionVersion, answers, ...(options.replace ? { replace: true } : {}) },
          options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {},
        );
        if (submitted.status === 'no_carriers') {
          (options.json ? console.error : info)('No carrier could take this one instantly. Sending it to a broker.');
          if (!options.json) printFloorDrops(submitted.partialFailures, '');
          await runBrokerHandoff(submissionId, answers, { json: !!options.json });
          return;
        }
        if (options.json && (submitted.status !== 'submitted' || options.wait === false)) {
          json({ submissionId, ...submitted });
          return;
        }
        if (submitted.status !== 'submitted') {
          info('Sent to a broker for these coverages.');
          info(`Check it: ${cliInvocation()} quote status ${submissionId}`);
          return;
        }
        if (!options.json) printFloorDrops(submitted.partialFailures, '');
        if (options.wait === false) {
          info(`Check premiums with: ${cliInvocation()} quote status ${submissionId} --wait`);
          return;
        }
        await waitAndPrint(submissionId, Number(options.timeout) * 60_000 || 600_000, !!options.json);
      } catch (err) {
        const guardLines = activeRequestLines(err, '<list>', {
          answersFile: options.answers,
          submit: { submissionId, sessionVersion: String(options.sessionVersion) },
        });
        if (guardLines) {
          error('Nothing was sent.');
          guardLines.forEach((l) => (options.json ? console.error(l) : info(l)));
          process.exit(1);
        }
        const answerLines = invalidAnswerLines(err);
        if (answerLines) {
          error('Nothing was sent.');
          answerLines.forEach((l) => console.error(l));
          process.exit(1);
        }
        console.error(`Before trying again, check whether it went through: ${cliInvocation()} quote status ${submissionId}`);
        failWith('Submit failed', err);
      }
    });

  quote
    .command('handoff <submissionId>')
    .description('Send a quote no carrier could take instantly to a broker, after the application questions they need')
    .option('-a, --answers <file>', 'JSON file of answers keyed by question id (skips the prompts)')
    .option('--json', 'Output as JSON')
    .action(async (submissionId: string, options) => {
      await runBrokerHandoff(submissionId, {}, { json: !!options.json, answersFile: options.answers });
    });

  quote
    .command('status <submissionId>')
    .description('Premiums and bindable offers for an instant quote')
    .option('--wait', 'Poll until every carrier answers')
    .option('--timeout <minutes>', 'How long to wait', '10')
    .option('--json', 'Output as JSON')
    .action(async (submissionId: string, options) => {
      if (options.wait) {
        await waitAndPrint(submissionId, Number(options.timeout) * 60_000 || 600_000, !!options.json);
        return;
      }
      try {
        const status = await getClient().instantQuotes.status(submissionId);
        if (options.json) json(status);
        else printQuoteTable(status);
      } catch (err) {
        failWith('API error', err);
      }
    });
}

async function waitAndPrint(submissionId: string, timeoutMs: number, asJson: boolean): Promise<void> {
  const client = getClient();
  const started = Date.now();
  const spinner = asJson ? null : ora('Waiting for carriers to price...').start();
  try {
    const status = await client.instantQuotes.waitForQuotes(submissionId, {
      timeoutMs,
      intervalMs: 10_000,
      onPoll: (s) => {
        if (spinner) spinner.text = `Waiting for carriers (${Math.round((Date.now() - started) / 1000)}s): ${summarizeStatus(s)}`;
      },
    });
    spinner?.stop();
    if (asJson) json(status);
    else printQuoteTable(status);
    if (stillWaiting(status) && !asJson) info(`Some carriers are still working. Check again: ${cliInvocation()} quote status ${submissionId} --wait`);
  } catch (err) {
    spinner?.fail('Could not read the quote');
    failWith('API error', err);
  }
}
