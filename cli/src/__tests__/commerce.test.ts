import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DeleganceError } from '@delegance/sdk';
import type { InstantQuestion } from '@delegance/sdk';
import {
  parseCoverages,
  isVisible,
  isRequired,
  coerceAnswer,
  validateAnswers,
  refusedStatementLines,
  sortQuoteRows,
  cheapestBindable,
  summarizeStatus,
  stillWaiting,
  carrierOutcome,
  referralLines,
} from '../commerce/questions';
import { formatQuoteStatus } from '../commands/quote';
import { DEMO_QUESTIONS, DEMO_STATUS } from '../commerce/demo';
import { savePendingSignup, loadPendingSignup, clearPendingSignup, pendingSignupPath } from '../utils/pending-signup';

vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

describe('parseCoverages', () => {
  it('maps the short names people type onto API coverage ids, deduped', () => {
    expect(parseCoverages('gl, WC,bop,pl,e&o,gl')).toEqual(['general_liability', 'workers_comp', 'business_owners', 'professional_liability']);
  });
  it('passes an unknown id through with dashes normalized', () => {
    expect(parseCoverages('tech-eo,liquor-liability')).toEqual(['tech_eo', 'liquor_liability']);
  });
});

describe('question visibility and coercion', () => {
  const vehicles = DEMO_QUESTIONS.find((q) => q.id === 'delivery_vehicles')!;
  it('hides a showIf follow-up until its parent has the matching answer', () => {
    expect(isVisible(vehicles, {})).toBe(false);
    expect(isVisible(vehicles, { delivery: 'no' })).toBe(false);
    expect(isVisible(vehicles, { delivery: 'yes' })).toBe(true);
    expect(isRequired(vehicles, { delivery: 'yes' })).toBe(true);
    expect(isRequired(vehicles, { delivery: 'no' })).toBe(false);
  });

  it('coerces by type', () => {
    const n = { id: 'n', label: 'n', type: 'currency', required: true } as InstantQuestion;
    expect(coerceAnswer(n, '$850,000')).toEqual({ ok: true, value: 850000 });
    expect(coerceAnswer(n, 'lots').ok).toBe(false);
    const yn = { id: 'y', label: 'y', type: 'yes_no', required: true } as InstantQuestion;
    expect(coerceAnswer(yn, 'Y')).toEqual({ ok: true, value: 'yes' });
    const sel = DEMO_QUESTIONS.find((q) => q.id === 'claims_5y')!;
    expect(coerceAnswer(sel, 'none')).toEqual({ ok: true, value: '0' });
    expect(coerceAnswer(sel, 'several').ok).toBe(false);
  });

  // GAIG "Current Insurance Carrier" (QA 2026-10-12): two separate options,
  // one with curly quotes. The old "Choose one of: a, b" list read the two as
  // one option, and a straight-quote value missed the curly-quote option.
  const carrierQ = {
    id: '058cf33c7d6d4e12',
    label: 'Current Insurance Carrier',
    type: 'select',
    required: true,
    options: [
      { label: 'N/A - This is a “New Business”', value: 'N/A - This is a “New Business”' },
      { label: 'I do not currently carry Businessowners insurance coverage', value: 'I do not currently carry Businessowners insurance coverage' },
      { label: 'Chubb', value: 'Chubb' },
    ],
  } as InstantQuestion;

  it('matches a select option typed with straight quotes, any case, extra spaces', () => {
    expect(coerceAnswer(carrierQ, 'N/A - This is a "New Business"')).toEqual({ ok: true, value: 'N/A - This is a “New Business”' });
    expect(coerceAnswer(carrierQ, '  n/a  -  this is a “new business” ')).toEqual({ ok: true, value: 'N/A - This is a “New Business”' });
    expect(coerceAnswer(carrierQ, 'I do not currently carry Businessowners insurance coverage')).toEqual({
      ok: true,
      value: 'I do not currently carry Businessowners insurance coverage',
    });
  });

  it('lists options quoted and separated so a comma inside one cannot split it', () => {
    const r = coerceAnswer(carrierQ, 'N/A - This is a "New Business", I do not currently carry Businessowners insurance coverage');
    expect(r.ok).toBe(false);
    const {message} = (r as { message: string });
    expect(message).toContain('"N/A - This is a “New Business”" | "I do not currently carry Businessowners insurance coverage" | "Chubb"');
  });
});

describe('validateAnswers (--answers file)', () => {
  it('uses prefills, drops hidden answers, and lists every missing required answer at once', () => {
    // claims_5y without its demo prefill, so a missing required answer is exercised.
    const questions = DEMO_QUESTIONS.map((q) => (q.id === 'claims_5y' ? { ...q, prefill: undefined } : q));
    const { answers, problems } = validateAnswers(questions, { delivery: 'no', delivery_vehicles: 3 });
    expect(answers).toEqual({ annual_revenue: 850000, employees: 6, delivery: 'no' });
    expect(problems).toEqual(['claims_5y: required ("Claims in the last 5 years")']);
  });

  it('ignores an invalid answer to a hidden follow-up', () => {
    const { answers, problems } = validateAnswers(DEMO_QUESTIONS, { delivery: 'no', delivery_vehicles: 'lots', claims_5y: '0' });
    expect(problems).toEqual([]);
    expect(answers.delivery_vehicles).toBeUndefined();
  });

  it('requires a follow-up once its parent makes it visible', () => {
    const { problems } = validateAnswers(DEMO_QUESTIONS, { delivery: 'yes', claims_5y: '0' });
    expect(problems).toEqual(['delivery_vehicles: required ("How many vehicles make deliveries?")']);
  });
});

// QA 2026-10-13: an answers file said "no" to AmTrust's BOP terrorism notice,
// and AmTrust never quoted with nothing on screen to say why.
describe('refusedStatementLines', () => {
  const stmt = (id: string, carriers: string[]): InstantQuestion => (({
    id, label: 'TERRORISM COVERAGE', type: 'yes_no', required: true, statement: { carriers },
  }));

  it('names each carrier whose statement the file answered No, and nothing for Yes or a regular question', () => {
    const questions = [
      stmt('s-amt', ['AMTRUST']),
      stmt('s-cot', ['COTERIE']),
      { id: 'q1', label: 'Seasonal?', type: 'yes_no', required: true } as unknown as InstantQuestion,
    ];
    const answers = { 's-amt': validateAnswers(questions, { 's-amt': 'no', 's-cot': 'yes', q1: 'no' }).answers['s-amt'], 's-cot': 'yes', q1: 'no' };
    expect(refusedStatementLines(questions, answers)).toEqual([
      "s-amt: you answered No to AMTRUST's statement, so AMTRUST will not quote. Answer yes to accept it as written.",
    ]);
  });

  it('says nothing for a statement the file did not answer', () => {
    expect(refusedStatementLines([stmt('s-amt', ['AMTRUST'])], {})).toEqual([]);
  });
});

describe('quote table ordering (spec visual treatment)', () => {
  it('puts bindable offers first, cheapest first, unpriced last', () => {
    const rows = sortQuoteRows(DEMO_STATUS.carrierQuotes);
    expect(rows.map((r) => r.carrier)).toEqual(['Carrier A', 'Carrier B', 'Carrier C', 'Carrier D']);
    expect(cheapestBindable(rows)?.opportunityId).toBe('demo-1');
    expect(summarizeStatus(DEMO_STATUS)).toBe('3 of 4 carriers priced, 1 declined');
  });

  it('never offers a bind on a non-QUOTED row even if bindable is set', () => {
    const rows = sortQuoteRows([{ ...DEMO_STATUS.carrierQuotes[0], state: 'QUOTING' }]);
    expect(rows[0].bindable).toBe(false);
    expect(cheapestBindable(rows)).toBeNull();
  });
});

describe('referred carriers count as answered', () => {
  const base = DEMO_STATUS.carrierQuotes[3];
  const declined = { ...base, carrierName: 'Coterie', state: 'DECLINED', marketStatus: 'declined', outcome: 'declined' };
  const referred = (carrierName: string) => ({ ...base, carrierName, state: 'REFERRED', marketStatus: 'pending', outcome: 'referred' });
  const pricing = { ...base, carrierName: 'Next', state: 'QUOTING', marketStatus: 'pending', outcome: 'pending' };

  it('1 declined + 2 referred is not waiting, even when an older server says unresolved', () => {
    const s = { ...DEMO_STATUS, allCarriersResolved: false, carrierQuotes: [declined, referred('Chubb'), referred('CNA')] };
    expect(stillWaiting(s)).toBe(false);
    expect(summarizeStatus(s)).toBe('0 of 3 carriers priced, 1 declined, 2 with an underwriter');
  });

  it('still waits while a carrier is pricing', () => {
    const s = { ...DEMO_STATUS, allCarriersResolved: false, carrierQuotes: [referred('Chubb'), pricing] };
    expect(stillWaiting(s)).toBe(true);
    expect(summarizeStatus(s)).toBe('0 of 2 carriers priced, 1 with an underwriter, still waiting on 1');
  });

  it('derives the outcome from state when the server sends none', () => {
    const { outcome: _drop, ...noOutcome } = referred('Chubb');
    expect(carrierOutcome(noOutcome)).toBe('referred');
    expect(carrierOutcome({ ...noOutcome, state: 'QUOTING' })).toBe('pending');
  });

  it('names needs-info carriers in their own line', () => {
    const s = { ...DEMO_STATUS, carrierQuotes: [{ ...referred('Chubb'), outcome: 'needs_info' }] };
    expect(referralLines(s)).toEqual(['Chubb needs more information before quoting. Delegance follows up with you.']);
    expect(summarizeStatus(s)).toBe('0 of 1 carriers priced, 1 needs more info');
  });

  // Bugbot on #5307: the table, the summary and the referral lines must agree.
  it('trusts the server outcome: an underwriter referral with a needs_info result is a referral everywhere', () => {
    const s = { ...DEMO_STATUS, carrierQuotes: [{ ...referred('Nationwide'), resultStatus: 'needs_info' }] };
    expect(sortQuoteRows(s.carrierQuotes)[0].status).toBe('referred');
    expect(referralLines(s)).toEqual(['Nationwide sent this to an underwriter instead of pricing it instantly. Delegance follows up with you.']);
    expect(summarizeStatus(s)).toBe('0 of 1 carriers priced, 1 with an underwriter');
  });

  it('with no outcome (older server), a REFERRED row with a needs_info result is needs-info, not a referral', () => {
    const { outcome: _drop, ...noOutcome } = referred('Chubb');
    const row = { ...noOutcome, resultStatus: 'needs_info' };
    expect(carrierOutcome(row)).toBe('needs_info');
    const s = { ...DEMO_STATUS, carrierQuotes: [row] };
    expect(referralLines(s)).toEqual(['Chubb needs more information before quoting. Delegance follows up with you.']);
    expect(sortQuoteRows(s.carrierQuotes)[0].status).toBe('needs_info');
  });

  it('a withheld carrier gets no referral or needs-info line: it was never sent', () => {
    const { outcome: _drop, ...noOutcome } = referred('AmTrust');
    const s = { ...DEMO_STATUS, carrierQuotes: [{ ...noOutcome, withheld: true }, { ...noOutcome, carrierName: 'Hiscox', withheld: true, resultStatus: 'needs_info' }] };
    expect(referralLines(s)).toEqual([]);
  });

  it('quote list cells say referred instead of processing', () => {
    expect(formatQuoteStatus({ status: 'processing', outcome: 'referred' })).toBe('↗ referred to an underwriter');
    expect(formatQuoteStatus({ status: 'processing' })).toBe('◐ processing');
    expect(formatQuoteStatus({ status: 'failed', outcome: 'declined' })).toBe('✗ declined');
  });
});

describe('pending signup file', () => {
  let home: string;
  beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-cli-')); });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('is written 0600 and removed after the key is stored', () => {
    const p = { enrollmentId: 'e', deviceSecret: 's', bootstrapKey: 'b', companyId: 'c', email: 'a@b.c', baseUrl: 'x', createdAt: 'now' };
    savePendingSignup(p, home);
    expect(fs.statSync(pendingSignupPath(home)).mode & 0o777).toBe(0o600);
    expect(loadPendingSignup(home)).toEqual(p);
    clearPendingSignup(home);
    expect(loadPendingSignup(home)).toBeNull();
  });

  it('refuses to write through a planted symlink', () => {
    const target = path.join(home, 'elsewhere.json');
    fs.mkdirSync(path.dirname(pendingSignupPath(home)), { recursive: true });
    fs.symlinkSync(target, pendingSignupPath(home));
    expect(() => savePendingSignup({ enrollmentId: 'e', deviceSecret: 's', bootstrapKey: 'b', companyId: 'c', email: 'a@b.c', baseUrl: 'x', createdAt: 'now' }, home)).toThrow(/symlink/);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('signup refusals', () => {
  it('explains account_exists, already_collected, and expired', async () => {
    const { exchangeRefusal } = await import('../commands/signup');
    const mk = (reason: string) => Object.assign(new DeleganceError('x', 409), { reason });
    expect(exchangeRefusal(mk('account_exists'))).toMatch(/already has a Delegance account/);
    expect(exchangeRefusal(mk('already_collected'))).toMatch(/already collected/);
    expect(exchangeRefusal(mk('expired'))).toMatch(/expired/);
    expect(exchangeRefusal(new Error('x'))).toBeNull();
  });
});

describe('formatCents', () => {
  it('formats cents as dollars', async () => {
    const { formatCents } = await import('../commands/commerce');
    expect(formatCents(61200)).toBe('$612');
  });
});

describe('storeOrPrintKey', () => {
  it('prints the key once when the disk write fails, so it is never lost', async () => {
    const { storeOrPrintKey } = await import('../commands/signup');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = storeOrPrintKey('dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345', () => { throw new Error('EACCES'); });
    expect(ok).toBe(false);
    expect(log.mock.calls.flat()).toContain('dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345');
    log.mockRestore();
    errSpy.mockRestore();
  });
});

describe('verify --resend failure', () => {
  it('keeps waiting when the bootstrap key is already revoked (the email was confirmed)', async () => {
    const { resendFailureMessage } = await import('../commands/signup');
    const revoked = new DeleganceError('Unauthorized', 401);
    expect(resendFailureMessage(revoked)).toMatch(/already confirmed/i);
  });
  it('keeps waiting on any other resend failure too', async () => {
    const { resendFailureMessage } = await import('../commands/signup');
    expect(resendFailureMessage(new DeleganceError('Too Many Requests', 429))).toMatch(/still waiting/i);
    expect(resendFailureMessage(new Error('network down'))).toMatch(/still waiting/i);
  });
});

describe('extractionOutcome (doc wait / doc reprocess --wait)', () => {
  it('classifies terminal and in-flight statuses', async () => {
    const { extractionOutcome } = await import('../commands/document');
    expect(extractionOutcome('completed')).toBe('done');
    expect(extractionOutcome('processed')).toBe('done');
    expect(extractionOutcome('failed')).toBe('failed');
    expect(extractionOutcome('error')).toBe('failed');
    expect(extractionOutcome('processing')).toBe('pending');
  });
});

describe('answerMode (quote start without a terminal)', () => {
  it('prompts only when stdin is a terminal', async () => {
    const { answerMode } = await import('../commands/instant-quote');
    expect(answerMode({ demo: false, hasAnswersFile: false, json: false, isTTY: true })).toBe('prompt');
    expect(answerMode({ demo: true, hasAnswersFile: false, json: false, isTTY: true })).toBe('prompt');
  });
  it('uses the demo suggestions instead of hanging when there is no terminal', async () => {
    const { answerMode } = await import('../commands/instant-quote');
    expect(answerMode({ demo: true, hasAnswersFile: false, json: false, isTTY: false })).toBe('suggested');
  });
  it('refuses a real quote with no terminal and no --answers, rather than exiting 0 silently', async () => {
    const { answerMode } = await import('../commands/instant-quote');
    expect(answerMode({ demo: false, hasAnswersFile: false, json: false, isTTY: false })).toBe('needs_answers');
  });
  it('keeps --answers and --json behaviour', async () => {
    const { answerMode } = await import('../commands/instant-quote');
    expect(answerMode({ demo: false, hasAnswersFile: true, json: false, isTTY: false })).toBe('file');
    expect(answerMode({ demo: false, hasAnswersFile: false, json: true, isTTY: false })).toBe('print_questions');
    expect(answerMode({ demo: true, hasAnswersFile: false, json: true, isTTY: false })).toBe('suggested');
  });
});

describe('suggestedAnswers', () => {
  it('fills every visible question from its prefill', async () => {
    const { suggestedAnswers } = await import('../commands/instant-quote');
    const a = suggestedAnswers(DEMO_QUESTIONS);
    expect(Object.keys(a).length).toBeGreaterThan(0);
    expect(validateAnswers(DEMO_QUESTIONS, a).problems).toEqual([]);
  });
});

describe('signup address (instant carriers need a state)', () => {
  it('lists every missing required field so a non-terminal run can fail loudly', async () => {
    const { missingSignupFields } = await import('../commands/signup');
    expect(missingSignupFields({ email: 'a@b.co', business: 'B', first: 'A', last: 'L', industry: 'bakery', size: '1' })).toEqual([
      '--street', '--city', '--state', '--zip',
    ]);
    expect(missingSignupFields({ email: 'a@b.co', business: 'B', first: 'A', last: 'L', industry: 'bakery', size: '1', street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' })).toEqual([]);
    expect(missingSignupFields({})).toEqual(['--email', '--business', '--first', '--last', '--industry', '--size', '--street', '--city', '--state', '--zip']);
  });
  it('validates state and ZIP the way the API does', async () => {
    const { addressProblem } = await import('../commands/signup');
    expect(addressProblem({ street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' })).toBeNull();
    expect(addressProblem({ street: '1 Main St', city: 'Austin', state: 'tx', zip: '78701-1234' })).toBeNull();
    expect(addressProblem({ street: '1 Main St', city: 'Austin', state: 'Texas', zip: '78701' })).toMatch(/state/i);
    expect(addressProblem({ street: '1 Main St', city: 'Austin', state: 'TX', zip: '787' })).toMatch(/zip/i);
  });
});

describe('bondStartLines (human output of "bond quote", shapes from app/services/propeller/quote-tools.ts)', () => {
  it('prints each question by its key so --answers can be built', async () => {
    const { bondStartLines } = await import('../commands/commerce');
    const lines = bondStartLines({ success: true, status: 'collecting', session_id: 's1', bond_name: 'WI Notary', questions: [{ key: 'owner_name', label: 'Owner name', control: 'text', options: [], required: true }] }).join('\n');
    expect(lines).toMatch(/owner_name: Owner name \(required\)/);
    expect(lines).toMatch(/delegance bond answer s1/);
    expect(lines).not.toMatch(/undefined/);
  });
  it('lists ambiguous candidates (names) with the exact --bond to rerun with', async () => {
    const { bondStartLines } = await import('../commands/commerce');
    const lines = bondStartLines({ success: true, note: 'Ask which one', candidates: ['Texas - Notary Public', "Texas - Notary with E&O ($10,000) Owner's"] }, { state: 'TX' }).join('\n');
    expect(lines).toMatch(/--state TX --bond 'Texas - Notary Public'/);
    // Single-quoted, with the apostrophe escaped, so &, $ and ' survive a paste into a shell.
    expect(lines).toContain('--bond \'Texas - Notary with E&O ($10,000) Owner\'\\\'\'s\'');
    expect(lines).not.toMatch(/<XX>/);
    const noState = bondStartLines({ candidates: ['Texas - Notary Public'] }).join('\n');
    expect(noState).not.toMatch(/--state/);
    expect(noState).toContain('--bond \'Texas - Notary Public\'');
    expect(lines).not.toMatch(/Ask which one/);
  });
  it('keeps a FED or full-name state in the rerun command, shell-quoted (bugbot 4887)', async () => {
    const { bondStartLines } = await import('../commands/commerce');
    const fed = bondStartLines({ candidates: ['Federal - Customs Bond'] }, { state: 'FED' }).join('\n');
    expect(fed).toContain('delegance bond quote --state \'FED\' --bond \'Federal - Customs Bond\'');
    const full = bondStartLines({ candidates: ['New York - Notary'] }, { state: 'New York' }).join('\n');
    expect(full).toContain('delegance bond quote --state \'New York\' --bond \'New York - Notary\'');
    const blank = bondStartLines({ candidates: ['X'] }, { state: '   ' }).join('\n');
    expect(blank).not.toMatch(/--state/);
  });
  it('lists finder matches with their apply links, never the model-facing note', async () => {
    const { bondStartLines } = await import('../commands/commerce');
    const lines = bondStartLines({ success: true, note: 'Share the filtered finder link so the user can pick', finderUrl: 'https://x/bonds', filteredUrl: 'https://x/bonds?q=n', matches: [{ name: 'WI Notary', applyUrl: 'https://surety/wi' }] }).join('\n');
    expect(lines).toMatch(/WI Notary/);
    expect(lines).toMatch(/https:\/\/surety\/wi/);
    expect(lines).not.toMatch(/Share the/);
  });
  it('offers the finder when nothing matched', async () => {
    const { bondStartLines } = await import('../commands/commerce');
    const lines = bondStartLines({ success: true, finderUrl: 'https://x/bonds', matches: [] }).join('\n');
    expect(lines).toMatch(/No bond matched/);
    expect(lines).toMatch(/https:\/\/x\/bonds/);
  });
  it('points a needs_discovery bond at the surety apply page', async () => {
    const { bondStartLines } = await import('../commands/commerce');
    const lines = bondStartLines({ success: true, status: 'needs_discovery', note: 'I do not have this bond mapped', finderUrl: 'https://x/bonds', applyUrl: 'https://surety/apply' }).join('\n');
    expect(lines).toMatch(/https:\/\/surety\/apply/);
    expect(lines).not.toMatch(/I do not have/);
  });
  it('asks for --bond-amount on a contract bond, and explains an underwriting route', async () => {
    const { bondStartLines } = await import('../commands/commerce');
    expect(bondStartLines({ success: true, needsAmount: true, note: 'Ask the user for a dollar figure' }).join('\n')).toMatch(/--bond-amount/);
    const uw = bondStartLines({ success: true, route: 'underwriting_submission', amount: '$2,000,000.00', instantIssueLimit: '$500,000.00', submissionRequirements: ['Financial statements'] }).join('\n');
    expect(uw).toMatch(/\$2,000,000\.00/);
    expect(uw).toMatch(/Financial statements/);
  });
});

describe('signupPrompts (no terminal must never reach inquirer)', () => {
  it('asks nothing without a terminal, even for the optional description', async () => {
    const { signupPrompts } = await import('../commands/signup');
    const full = { email: 'a@b.co', business: 'B', first: 'A', last: 'L', industry: 'bakery', size: '1', street: '1 Main', city: 'Austin', state: 'TX', zip: '78701' };
    expect(signupPrompts(full, false)).toEqual([]);
    expect(signupPrompts({}, false)).toEqual([]);
  });
  it('asks only for what is missing in a terminal, description included', async () => {
    const { signupPrompts } = await import('../commands/signup');
    const names = signupPrompts({ email: 'a@b.co', business: 'B', first: 'A', last: 'L', industry: 'bakery', size: '1', street: '1 Main', city: 'Austin', state: 'TX', zip: '78701' }, true).map((q) => q.name);
    expect(names).toEqual(['description']);
  });
});

describe('demo carrier names', () => {
  // The demo prints sample premiums. A real carrier's name beside a made-up price reads
  // as a real quote from that carrier, so the demo may only use generic names.
  it('never pairs a real carrier name with a sample premium', async () => {
    const { DEMO_STATUS } = await import('../commerce/demo');
    const real = /coterie|chubb|pie insurance|amtrust|markel|cna|coalition|hiscox|hartford|travelers|next insurance/i;
    for (const q of DEMO_STATUS.carrierQuotes) {
      expect(q.carrierName).not.toMatch(real);
      expect(q.carrierId).not.toMatch(real);
    }
  });
});

describe('buildingYearProblems (answer-time check, QA 2026-10-12)', () => {
  it('flags a roof older than the building and future years; ignores 0', async () => {
    const { buildingYearProblems } = await import('../commerce/questions');
    const now = new Date('2026-10-12T00:00:00Z');
    expect(buildingYearProblems({ acord_property_year_built: 1998, acord_property_roof_year: 2015 }, now)).toEqual([]);
    expect(buildingYearProblems({ acord_property_year_built: 0, acord_property_roof_year: 0 }, now)).toEqual([]);
    expect(buildingYearProblems({ acord_property_year_built: 2018, acord_property_roof_year: 2015 }, now))
      .toEqual(['acord_property_roof_year: the roof cannot have been replaced before the building was built']);
    expect(buildingYearProblems({ acord_property_roof_year: 2030 }, now)).toEqual(['acord_property_roof_year: cannot be after 2026']);
  });

  it('reads the bare ids that start questions and --answers files carry', async () => {
    const { buildingYearProblems } = await import('../commerce/questions');
    const now = new Date('2026-10-12T00:00:00Z');
    expect(buildingYearProblems({ property_year_built: 2018, property_roof_year: 2015 }, now))
      .toEqual(['property_roof_year: the roof cannot have been replaced before the building was built']);
    expect(buildingYearProblems({ property_year_built: '2030' }, now)).toEqual(['property_year_built: cannot be after 2026']);
  });
});

describe('status summary once every carrier has answered (QA 2026-10-12, 7213ba59)', () => {
  const q = (carrierId: string, state: string, extra: Record<string, unknown> = {}) => ({
    opportunityId: carrierId, carrierId, carrierName: carrierId, coverage: 'CGL', state,
    marketStatus: state === 'REFERRED' ? 'pending' : state.toLowerCase(), premium: null, quoteNumber: null, bindable: false, ...extra,
  });
  const status = (carrierQuotes: unknown[]) => ({
    submissionId: 's', carrierQuotes, withheldCarriers: [], allCarriersResolved: false, awaitingBrokerReviewCount: 0,
  }) as never;

  it('never says "still waiting" when the only open row is a referral, and names the declines', async () => {
    const { summarizeStatus, declineNote } = await import('../commerce/questions');
    const s = status([
      q('COTERIE', 'QUOTED', { premium: 1625, bindable: true }),
      q('NATIONWIDE', 'REFERRED'),
      q('CNA', 'DECLINED'),
      q('TRAVELERS', 'DECLINED'),
    ]);
    expect(summarizeStatus(s)).toBe('1 of 4 carriers priced, 2 declined, 1 with an underwriter');
    expect(declineNote(s)).toMatch(/^Declines are normal/);
  });

  it('counts only carriers still pricing as waiting, and holds the decline note until they finish', async () => {
    const { summarizeStatus, declineNote } = await import('../commerce/questions');
    const s = status([q('CNA', 'DECLINED'), q('CHUBB', 'PENDING'), q('COTERIE', 'SUBMITTED'), q('HISCOX', 'FAILED')]);
    expect(summarizeStatus(s)).toBe('0 of 4 carriers priced, 1 declined, 1 failed, still waiting on 2');
    expect(declineNote(s)).toBeNull();
  });
});

// GAIG BOP, QA e2e 2026-10-12: a 0 Accounts Receivable limit went to GAIG,
// which accepts 25,000 to 250,000.
describe('coerceAnswer: carrier range', () => {
  const ar = { id: 'a065c25d8cf5397a', label: 'Accounts Receivable Limit ($25,000 is included)', type: 'number', required: true, validation: { min: 25000, max: 250000 } };
  it('refuses a number outside the range, naming it', () => {
    expect(coerceAnswer(ar, '0')).toEqual({ ok: false, message: 'Enter a number from 25,000 to 250,000.' });
    expect(coerceAnswer(ar, '300000')).toMatchObject({ ok: false });
  });
  it('accepts a number inside it', () => {
    expect(coerceAnswer(ar, '25,000')).toEqual({ ok: true, value: 25000 });
  });
  it('validateAnswers reports it for an --answers file', () => {
    const { problems } = validateAnswers([ar], { a065c25d8cf5397a: 0 });
    expect(problems.join(' ')).toContain('25,000 to 250,000');
  });
});
