/**
 * Pure helpers for the terminal quote flow: coverage aliases, which questions
 * are visible, answer coercion, and the results table. No I/O, so each one is
 * unit-tested directly.
 */

import type { InstantQuestion, CarrierQuote, InstantQuoteStatus } from '@delegance/sdk';
import { coverageName } from '../utils/coverage-names';

/** Short names people type, mapped to the quote coverage ids the API accepts. */
export const COVERAGE_ALIASES: Record<string, string> = {
  gl: 'general_liability',
  'general-liability': 'general_liability',
  wc: 'workers_comp',
  'workers-comp': 'workers_comp',
  bop: 'business_owners',
  cyber: 'cyber',
  pl: 'professional_liability',
  eo: 'professional_liability',
  'e&o': 'professional_liability',
  mpl: 'professional_liability',
  'tech-eo': 'tech_eo',
  auto: 'commercial_auto',
  property: 'commercial_property',
  umbrella: 'umbrella',
  excess: 'umbrella',
};

export function parseCoverages(raw: string): string[] {
  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => COVERAGE_ALIASES[s] ?? s.replace(/-/g, '_'));
  return [...new Set(ids)];
}

/** A question is shown unless its showIf rule names an answer it does not have. */
export function isVisible(q: InstantQuestion, answers: Record<string, unknown>): boolean {
  const rule = q.showIf as { questionId?: string; equals?: string[] } | undefined;
  if (!rule || !rule.questionId || !Array.isArray(rule.equals)) return true;
  const a = answers[rule.questionId];
  if (a === undefined || a === null) return false;
  return rule.equals.map(String).includes(String(a));
}

/** Required when `required`, or `requiredIfShown` and visible. */
export function isRequired(q: InstantQuestion, answers: Record<string, unknown>): boolean {
  return q.required === true || (q.requiredIfShown === true && isVisible(q, answers));
}

export type Coerced = { ok: true; value: unknown } | { ok: false; message: string };

/**
 * The carrier's numeric range the server sends on a number question (absent
 * on older servers). Mirrors app/services/quote-submission/number-range.ts:
 * this package cannot import app code, so keep the sentence identical.
 */
function numberRange(q: InstantQuestion): { min?: number; max?: number } {
  const v = q.validation as { min?: unknown; max?: unknown } | undefined;
  const read = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);
  return { min: read(v?.min), max: read(v?.max) };
}

function rangeMessage(range: { min?: number; max?: number }): string {
  const f = (n: number) => n.toLocaleString('en-US');
  if (range.min !== undefined && range.max !== undefined) return `Enter a number from ${f(range.min)} to ${f(range.max)}.`;
  if (range.min !== undefined) return `Enter a number of at least ${f(range.min)}.`;
  return `Enter a number no higher than ${f(range.max as number)}.`;
}

/** A carrier statement: a declaration the insured accepts, not a fact about the business. */
export function isStatement(q: InstantQuestion): boolean {
  const s = q.statement as { carriers?: unknown } | undefined;
  return !!s && typeof s === 'object';
}

/**
 * One line per carrier statement an answers file said No to. A No keeps that
 * carrier from quoting (the server never sends a Yes the insured did not
 * give), and a file answer has no prompt to say so. QA 2026-10-13: AmTrust's
 * BOP terrorism notice was answered No and AmTrust never quoted.
 */
export function refusedStatementLines(questions: InstantQuestion[], answers: Record<string, unknown>): string[] {
  const refused = (v: unknown): boolean => v === false || (typeof v === 'string' && /^\s*(no|n|false)\s*$/i.test(v));
  return questions
    .filter((q) => isStatement(q) && q.id in answers && refused(answers[q.id]))
    .map((q) => {
      const carriers = ((q.statement as { carriers?: unknown }).carriers as string[] | undefined) ?? [];
      const who = carriers.length ? carriers.join(', ') : 'This carrier';
      const whose = carriers.length ? `${who}'s` : 'a carrier';
      return `${q.id}: you answered No to ${whose} statement, so ${who} will not quote. Answer yes to accept it as written.`;
    });
}

/**
 * An option compared the way a person types it: curly quotes and apostrophes
 * as straight ones, any dash as a hyphen, runs of whitespace as one space,
 * case ignored. Carrier options carry smart quotes (`This is a “New
 * Business”`) that a terminal user types straight.
 */
export function optionKey(s: string): string {
  return s
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Options listed so a comma INSIDE an option cannot read as a separator: each
 * one quoted, separated by " | ". A carrier option can hold a comma, and the
 * old comma-joined list made two options read as one.
 */
export function formatOptionList(options: string[]): string {
  return options.map((o) => `"${o}"`).join(' | ');
}

/** Turn typed text into the value the API expects for the question type. */
export function coerceAnswer(q: InstantQuestion, raw: unknown): Coerced {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined };
  const text = String(raw).trim();
  switch (q.type) {
    case 'number':
    case 'currency':
    case 'percentage': {
      const n = Number(text.replace(/[$,%\s]/g, ''));
      if (!Number.isFinite(n)) return { ok: false, message: 'Enter a number.' };
      // The carrier's published range: a value outside it is refused at submit.
      const range = numberRange(q);
      if ((range.min !== undefined && n < range.min) || (range.max !== undefined && n > range.max)) {
        return { ok: false, message: rangeMessage(range) };
      }
      return { ok: true, value: n };
    }
    case 'yes_no': {
      const t = text.toLowerCase();
      if (['y', 'yes', 'true', '1'].includes(t)) return { ok: true, value: 'yes' };
      if (['n', 'no', 'false', '0'].includes(t)) return { ok: true, value: 'no' };
      return { ok: false, message: 'Answer yes or no.' };
    }
    case 'select': {
      const opts = q.options ?? [];
      const key = optionKey(text);
      const hit = opts.find((o) => o.value === text)
        ?? opts.find((o) => optionKey(o.value) === key)
        ?? opts.find((o) => optionKey(o.label) === key);
      return hit
        ? { ok: true, value: hit.value }
        : { ok: false, message: `Choose one of: ${formatOptionList(opts.map((o) => o.value))}` };
    }
    default:
      return { ok: true, value: text };
  }
}

/**
 * Check an answers map (from --answers) against the questions. Returns the
 * cleaned map and the problems, so the caller can print every problem at once.
 */
export function validateAnswers(
  questions: InstantQuestion[],
  provided: Record<string, unknown>,
): { answers: Record<string, unknown>; problems: string[] } {
  const answers: Record<string, unknown> = {};
  const invalid = new Map<string, string>();
  // Pass 1 coerces everything, so a showIf parent answered later in the list
  // still counts; a coercion problem is only reported if the question is shown.
  for (const q of questions) {
    const raw = provided[q.id] ?? q.prefill;
    const c = coerceAnswer(q, raw);
    if (!c.ok) invalid.set(q.id, c.message);
    else if (c.value !== undefined) answers[q.id] = c.value;
  }
  const problems: string[] = [];
  for (const q of questions) {
    if (!isVisible(q, answers)) {
      // A hidden question never gates and never sends an answer.
      delete answers[q.id];
      // eslint-disable-next-line no-continue -- hidden questions are skipped
      continue;
    }
    const bad = invalid.get(q.id);
    if (bad) problems.push(`${q.id}: ${bad}`);
    else if (isRequired(q, answers) && answers[q.id] === undefined) problems.push(`${q.id}: required ("${q.label}")`);
  }
  problems.push(...buildingYearProblems(answers));
  return { answers, problems };
}

/**
 * The roof cannot predate the building, and neither year can be in the
 * future (a carrier refuses the whole application otherwise). 0 means "no
 * premises" and is never compared. Exported for tests.
 */
export function buildingYearProblems(answers: Record<string, unknown>, now: Date = new Date()): string[] {
  // The session asks under the acord_* id; `start` questions and --answers
  // files may carry the bare id. Report the key the answers actually used.
  const year = (id: string): { key: string; n: number } | null => {
    for (const key of [`acord_${id}`, id]) {
      const raw = answers[key];
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        const n = Number(String(raw).trim());
        return Number.isInteger(n) && n > 0 ? { key, n } : null;
      }
    }
    return null;
  };
  const thisYear = now.getUTCFullYear();
  const built = year('property_year_built');
  const roof = year('property_roof_year');
  const out: string[] = [];
  if (built !== null && built.n > thisYear) out.push(`${built.key}: cannot be after ${thisYear}`);
  if (roof !== null && roof.n > thisYear) out.push(`${roof.key}: cannot be after ${thisYear}`);
  else if (roof !== null && built !== null && built.n <= thisYear && roof.n < built.n) {
    out.push(`${roof.key}: the roof cannot have been replaced before the building was built`);
  }
  return out;
}

export interface QuoteRow {
  carrier: string;
  coverage: string;
  premium: number | null;
  status: string;
  bindable: boolean;
  opportunityId: string;
  /** Human-readable limits; null when the server did not send them. */
  limits: string | null;
  /** Deductible in dollars; null when the server did not send it. */
  deductible: number | null;
  /** Why the carrier did not price (decline reason, needs-info ask); null when none. */
  message: string | null;
  /** A carrier the submit held back: no offer, never bindable. */
  withheld: boolean;
}

/** Fields newer servers add to a carrier quote. Read defensively: older SDKs and servers lack them. */
type CarrierQuoteDetail = CarrierQuote & {
  limits?: string | null;
  deductible?: number | null;
  outcome?: string | null;
  resultStatus?: string | null;
  message?: string | null;
  withheld?: boolean;
};

/** Opportunity state -> instant-leg outcome, for servers that do not send `outcome`. */
const STATE_OUTCOMES: Record<string, string> = {
  QUOTED: 'quoted',
  BOUND: 'bound',
  REFERRED: 'referred',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  FAILED: 'failed',
};

/**
 * What a carrier's instant leg ended in: the server's `outcome`, else derived
 * from `state`. 'referred' means the carrier sent the risk to an underwriter;
 * only 'pending' means the carrier is still pricing.
 */
export function carrierOutcome(q: CarrierQuote): string {
  const sent = (q as CarrierQuoteDetail).outcome;
  if (typeof sent === 'string' && sent.trim()) return sent.trim().toLowerCase();
  const state = (q.state ?? '').toUpperCase();
  // No `outcome` (an older server, or a withheld row): REFERRED covers both a
  // referral and a closed needs-info application, and only resultStatus tells
  // them apart.
  if (state === 'REFERRED' && (q as CarrierQuoteDetail).resultStatus === 'needs_info') return 'needs_info';
  return STATE_OUTCOMES[state] ?? 'pending';
}

/**
 * The status word source for one row. The server's marketStatus folds
 * REFERRED into `pending`, which read as "Pricing" while nothing was pricing,
 * so a referral never wins there. A referral is a referral to an underwriter,
 * or (outcome or resultStatus `needs_info`) a closed application the carrier
 * needs answers for.
 */
function rowStatus(q: CarrierQuoteDetail): string {
  // carrierOutcome trusts the server's `outcome` when sent and reads
  // resultStatus only when it is not, so the table, summarizeStatus and
  // referralLines all agree on what a REFERRED row is.
  const outcome = carrierOutcome(q);
  if (outcome === 'needs_info') return 'needs_info';
  if (outcome === 'referred') return 'referred';
  // A carrier or sandbox outage the server stores as a decline (CNA "Internal
  // Server Error", QA 2026-10-13). Newer servers say so in resultStatus.
  if (q.resultStatus === 'carrier_unavailable') return 'carrier_unavailable';
  return q.marketStatus || q.state;
}

/** Bindable first, then premium ascending, unpriced last. */
export function sortQuoteRows(quotes: CarrierQuote[]): QuoteRow[] {
  return (quotes as CarrierQuoteDetail[])
    .map((q) => ({
      carrier: q.carrierName || q.carrierId,
      coverage: q.coverage ?? '',
      premium: q.premium,
      status: rowStatus(q),
      bindable: q.bindable === true && q.state === 'QUOTED',
      opportunityId: q.opportunityId,
      limits: typeof q.limits === 'string' && q.limits.trim() ? q.limits : null,
      deductible: typeof q.deductible === 'number' && Number.isFinite(q.deductible) ? q.deductible : null,
      message: typeof q.message === 'string' && q.message.trim() ? q.message.trim() : null,
      withheld: q.withheld === true,
    }))
    .sort((a, b) => {
      if (a.bindable !== b.bindable) return a.bindable ? -1 : 1;
      if (a.premium === null && b.premium === null) return 0;
      if (a.premium === null) return 1;
      if (b.premium === null) return -1;
      return a.premium - b.premium;
    });
}

export function cheapestBindable(rows: QuoteRow[]): QuoteRow | null {
  return rows.find((r) => r.bindable && r.premium !== null) ?? null;
}

/**
 * The cheapest bindable priced offer for each coverage. Prices are compared
 * only within a coverage (codes that name the same coverage count as one), so
 * a GL premium never beats a WC one. Coverages come out cheapest first; a
 * coverage with no bindable price is left out.
 */
export function bestPerCoverage(rows: QuoteRow[]): QuoteRow[] {
  const best = new Map<string, QuoteRow>();
  for (const r of rows) {
    // eslint-disable-next-line no-continue -- only bindable priced offers compete
    if (!r.bindable || r.premium === null) continue;
    const key = coverageName(r.coverage);
    const cur = best.get(key);
    if (!cur || r.premium < (cur.premium as number)) best.set(key, r);
  }
  return [...best.values()].sort((a, b) => (a.premium as number) - (b.premium as number));
}

/** Rows grouped by coverage, keeping the order of each coverage's first row. Stable inside a group. */
export function groupRowsByCoverage(rows: QuoteRow[]): QuoteRow[] {
  const order = new Map<string, number>();
  rows.forEach((r) => {
    const key = coverageName(r.coverage);
    if (!order.has(key)) order.set(key, order.size);
  });
  const rank = (r: QuoteRow): number => order.get(coverageName(r.coverage))!;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i)
    .map((x) => x.r);
}

/** Plain words for the server's carrier-quote states (marketStatus, else state). */
const STATUS_WORDS: Record<string, string> = {
  quote: 'Quoted',
  quoted: 'Quoted',
  declined: 'Declined',
  decline: 'Declined',
  quoting: 'Pricing',
  pending: 'Pricing',
  submitted: 'Pricing',
  in_progress: 'Pricing',
  referred: 'Referred to an underwriter',
  refer: 'Referred to an underwriter',
  needs_info: 'Needs more info',
  awaiting_broker_review: 'With a broker',
  broker_review: 'With a broker',
  bind_requested: 'Bind requested',
  bound: 'Bound',
  expired: 'Expired',
  error: 'Failed',
  failed: 'Failed',
  carrier_unavailable: 'Carrier unavailable, retry later',
};

/** "quote" -> "Quoted", "DECLINED" -> "Declined". Unknown states become sentence case. */
export function quoteStatusWord(status: string): string {
  const key = status.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (STATUS_WORDS[key]) return STATUS_WORDS[key];
  const words = key.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : status;
}

/**
 * True while some carrier is still pricing. Referred, needs-info and declined
 * carriers have answered, so they never keep this true, even against an older
 * server whose allCarriersResolved still counted a referral as unresolved.
 */
export function stillWaiting(s: InstantQuoteStatus): boolean {
  if (s.allCarriersResolved) return false;
  if (s.carrierQuotes.length === 0) return true;
  return s.carrierQuotes.some((q) => carrierOutcome(q) === 'pending');
}

/**
 * The status cell for one row. A priced quote says how it binds, because the
 * cheapest price is not always one the insured can bind online.
 */
export function rowStatusWord(r: QuoteRow): string {
  const word = quoteStatusWord(r.status);
  if (word !== 'Quoted' || r.premium === null) return word;
  return r.bindable ? 'Quoted, bind online' : 'Quoted, bind through Delegance';
}

/**
 * The cheapest priced offer per coverage that cannot be bound online and
 * either beats that coverage's best bindable price or has no bindable price
 * to beat. QA 2026-10-13: Chubb quoted $2,610 while the CLI named Coterie
 * $2,789 as the best price, because only Coterie could be bound online.
 */
export function cheaperOfflinePerCoverage(rows: QuoteRow[], best: QuoteRow[]): QuoteRow[] {
  const bestBy = new Map(best.map((r) => [coverageName(r.coverage), r.premium as number]));
  const cheaper = new Map<string, QuoteRow>();
  rows
    .filter((r) => !r.bindable && r.premium !== null && !r.withheld && quoteStatusWord(r.status) === 'Quoted')
    .forEach((r) => {
      const key = coverageName(r.coverage);
      const bar = bestBy.get(key);
      if (bar !== undefined && (r.premium as number) >= bar) return;
      const cur = cheaper.get(key);
      if (!cur || (r.premium as number) < (cur.premium as number)) cheaper.set(key, r);
    });
  return [...cheaper.values()].sort((a, b) => (a.premium as number) - (b.premium as number));
}

export function summarizeStatus(s: InstantQuoteStatus): string {
  // A withheld row (newer servers) is a carrier that was never sent, not an
  // offer: it is counted under "not sent" only.
  const offers = (s.carrierQuotes as CarrierQuoteDetail[]).filter((q) => q.withheld !== true);
  const quoted = offers.filter((q) => q.premium !== null).length;
  const words = offers.filter((q) => q.premium === null).map((q) => quoteStatusWord(rowStatus(q)));
  const count = (w: string): number => words.filter((x) => x === w).length;
  const parts = [`${quoted} of ${offers.length} carriers priced`];
  const declined = count('Declined');
  if (declined > 0) parts.push(`${declined} declined`);
  const referred = count('Referred to an underwriter');
  if (referred > 0) parts.push(`${referred} with an underwriter`);
  const failed = count('Failed');
  if (failed > 0) parts.push(`${failed} failed`);
  const unavailable = count('Carrier unavailable, retry later');
  if (unavailable > 0) parts.push(`${unavailable} unavailable`);
  const needsInfo = count('Needs more info');
  if (needsInfo > 0) parts.push(`${needsInfo} need${needsInfo === 1 ? 's' : ''} more info`);
  if (s.awaitingBrokerReviewCount > 0) parts.push(`${s.awaitingBrokerReviewCount} with a broker for review`);
  const withheld = Math.max(
    s.withheldCarriers?.length ?? 0,
    s.carrierQuotes.length - offers.length,
  );
  if (withheld > 0) parts.push(`${withheld} not sent`);
  // The server counts a referral as unresolved, so "waiting" is said only
  // while a carrier is actually still pricing.
  if (stillWaiting(s)) {
    const pricing = offers.filter((q) => carrierOutcome(q) === 'pending').length;
    parts.push(pricing > 0 ? `still waiting on ${pricing}` : 'still waiting on the rest');
  }
  return parts.join(', ');
}

function carrierList(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique.join('');
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
}

/** One plain line per referral kind, printed under the table. Empty when nothing was referred. */
export function referralLines(s: InstantQuoteStatus): string[] {
  // A withheld carrier was never sent, so it neither referred nor asked for
  // anything; withheldLines speaks for it.
  const names = (outcome: string): string[] => (s.carrierQuotes as CarrierQuoteDetail[])
    .filter((q) => q.withheld !== true && carrierOutcome(q) === outcome)
    .map((q) => q.carrierName || q.carrierId);
  const lines: string[] = [];
  const referred = names('referred');
  if (referred.length) {
    lines.push(`${carrierList(referred)} sent this to an underwriter instead of pricing it instantly. Delegance follows up with you.`);
  }
  const needsInfo = names('needs_info');
  if (needsInfo.length) {
    const verb = new Set(needsInfo).size === 1 ? 'needs' : 'need';
    lines.push(`${carrierList(needsInfo)} ${verb} more information before quoting. Delegance follows up with you.`);
  }
  return lines;
}

/**
 * Said once every carrier has answered and at least one declined, so a
 * decline reads as appetite, not as a failure. Null otherwise. Exported for tests.
 */
export function declineNote(s: InstantQuoteStatus): string | null {
  const offers = (s.carrierQuotes as CarrierQuoteDetail[]).filter((q) => q.withheld !== true);
  const words = offers.map((q) => quoteStatusWord(rowStatus(q)));
  if (words.includes('Pricing') || !words.includes('Declined')) return null;
  return 'Declines are normal: each carrier writes only certain kinds of business. A referral comes back once an underwriter looks at it.';
}
/** Plain words for the server's suggestion route codes. */
const SUGGESTION_SOURCES: Record<string, string> = {
  acord_suggest: 'suggested from your business profile',
};

/** A value some source already holds for a question, and where it came from. */
export interface KnownValue {
  value: unknown;
  /** `prefill` is the insured's own account data; `suggested` is an inference to confirm. */
  kind: 'prefill' | 'suggested';
  source: string;
}

/** Plain words for the record a value on file came from (`prefillProvenance.source`). */
const RECORD_SOURCES: Record<string, string> = {
  prior_application: 'your last application',
  equivalence: 'your last application',
  acord_form: 'an ACORD form on file',
  acord_125: 'your ACORD 125 on file',
  acord_126: 'your ACORD 126 on file',
  acord_130: 'your ACORD 130 on file',
  acord_140: 'your ACORD 140 on file',
  company_record: 'your company record',
  onboarding: 'your onboarding answers',
};

/** "your ACORD 126 on file, 2026-10-08" from a provenance block; null when it names no known record. */
function recordSource(q: InstantQuestion): string | null {
  const p = q.prefillProvenance as { source?: unknown; sourceDate?: unknown } | undefined;
  const label = p && typeof p.source === 'string' ? RECORD_SOURCES[p.source] : undefined;
  if (!label) return null;
  const date = typeof p?.sourceDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(p.sourceDate) ? p.sourceDate.slice(0, 10) : null;
  return date ? `${label}, ${date}` : label;
}

/** The value a source holds for this question, or null when no source answered it. */
export function knownValue(q: InstantQuestion): KnownValue | null {
  if (q.prefill !== undefined && q.prefill !== null && q.prefill !== '') {
    const source = recordSource(q) ?? (q.prefillSource === 'prior_application' ? 'your last application' : 'your account');
    return { value: q.prefill, kind: 'prefill', source };
  }
  const s = q.suggested as { value?: unknown; route?: string } | undefined;
  if (s && s.value !== undefined && s.value !== null && s.value !== '') {
    const route = s.route ? String(s.route) : '';
    const onFile = recordSource(q);
    const source = SUGGESTION_SOURCES[route] ?? (onFile ? `from ${onFile}, please check` : 'suggested, please check');
    return { value: s.value, kind: 'suggested', source };
  }
  return null;
}

export interface QuestionRound {
  /** Answered by a source: shown together on one confirm screen. */
  confirm: InstantQuestion[];
  /** Required yes/no questions no source answered: one checklist screen. */
  checklist: InstantQuestion[];
  /** Required select/text/number questions no source answered: asked one by one. */
  ask: InstantQuestion[];
}

/**
 * The next round of prompts. Only visible questions not yet handled count.
 * Optional questions with no source are skipped, so the insured sees only what
 * a carrier needs. A showIf follow-up shows up in a later round once its
 * parent is answered.
 */
export function planQuestionRound(
  questions: InstantQuestion[],
  answers: Record<string, unknown>,
  handled: Set<string>,
): QuestionRound {
  const round: QuestionRound = { confirm: [], checklist: [], ask: [] };
  for (const q of questions) {
    // eslint-disable-next-line no-continue -- already asked, or hidden for now
    if (handled.has(q.id) || !isVisible(q, answers)) continue;
    if (knownValue(q)) round.confirm.push(q);
    else if (!isRequired(q, answers)) handled.add(q.id);
    // A statement is accepted on its own, with its full text: in the checklist
    // an unchecked box meant No and silently dropped the carrier.
    else if (q.type === 'yes_no' && !isStatement(q)) round.checklist.push(q);
    else round.ask.push(q);
  }
  return round;
}

/** Turn the checked ids of a checklist into yes/no answers: unchecked means No. */
export function checklistAnswers(items: InstantQuestion[], checkedIds: string[]): Record<string, 'yes' | 'no'> {
  const checked = new Set(checkedIds);
  const out: Record<string, 'yes' | 'no'> = {};
  for (const q of items) out[q.id] = checked.has(q.id) ? 'yes' : 'no';
  return out;
}

/** Short display of a known value for the confirm screen. */
export function formatKnown(q: InstantQuestion, value: unknown): string {
  if (q.type === 'yes_no') return String(value).toLowerCase() === 'yes' || value === true ? 'Yes' : 'No';
  if (q.type === 'select') {
    const hit = (q.options ?? []).find((o) => o.value === String(value));
    if (hit) return hit.label;
  }
  return String(value);
}
