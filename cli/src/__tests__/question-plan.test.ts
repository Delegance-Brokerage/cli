import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { InstantQuestion } from '@delegance/sdk';
import { planQuestionRound, checklistAnswers, knownValue, formatKnown } from '../commerce/questions';
import { DEMO_QUESTIONS } from '../commerce/demo';

const q = (over: Partial<InstantQuestion> & { id: string }): InstantQuestion =>
  ({ label: over.id, type: 'text', required: true, ...over }) as InstantQuestion;

describe('knownValue', () => {
  it('treats account prefill as prefill and an inference as a suggestion', () => {
    expect(knownValue(q({ id: 'a', prefill: 12 }))).toMatchObject({ kind: 'prefill', value: 12 });
    expect(knownValue(q({ id: 'b', suggested: { value: 'yes', route: 'acord_suggest' } }))).toMatchObject({ kind: 'suggested', source: 'suggested from your business profile' });
    expect(knownValue(q({ id: 'b2', suggested: { value: 'yes', route: 'x' } }))?.source).toBe('suggested, please check');
    expect(knownValue(q({ id: 'c', prefill: '' }))).toBeNull();
    expect(knownValue(q({ id: 'd' }))).toBeNull();
  });
  it('cites the record a value on file came from, with its date', () => {
    const fromForm = q({ id: 'f', prefill: 20000, prefillSource: 'prior_application', prefillProvenance: { source: 'acord_126', sourceDate: '2026-10-08T19:43:57Z' } });
    expect(knownValue(fromForm)?.source).toBe('your ACORD 126 on file, 2026-10-08');
    const attest = q({ id: 'g', suggested: { value: 'No', route: 'prior_application' }, prefillProvenance: { source: 'acord_125', sourceDate: null, attestation: true } });
    expect(knownValue(attest)).toMatchObject({ kind: 'suggested', source: 'from your ACORD 125 on file, please check' });
    expect(knownValue(q({ id: 'h', prefill: 1, prefillProvenance: { source: 'mystery' } }))?.source).toBe('your account');
  });
  it('prefers the account value when both exist', () => {
    expect(knownValue(q({ id: 'e', prefill: 3, suggested: { value: 9 } }))?.value).toBe(3);
  });
});

// The demo gives delivery and claims_5y a prefill so a demo with no terminal can
// finish on suggested answers. The planner test needs one unanswered yes/no and
// one unanswered select, so it strips those two prefills from its own copy.
const PLAN_QUESTIONS: InstantQuestion[] = DEMO_QUESTIONS.map((x) =>
  (x.id === 'delivery' || x.id === 'claims_5y' ? { ...x, prefill: undefined } : x));

describe('planQuestionRound', () => {
  it('splits the demo into confirm, checklist and ask, then reveals the follow-up', () => {
    const handled = new Set<string>();
    const r1 = planQuestionRound(PLAN_QUESTIONS, {}, handled);
    expect(r1.confirm.map((x) => x.id)).toEqual(['annual_revenue', 'employees']);
    expect(r1.checklist.map((x) => x.id)).toEqual(['delivery']);
    expect(r1.ask.map((x) => x.id)).toEqual(['claims_5y']);
    [...r1.confirm, ...r1.checklist, ...r1.ask].forEach((x) => handled.add(x.id));

    const r2 = planQuestionRound(PLAN_QUESTIONS, { delivery: 'yes' }, handled);
    expect(r2.ask.map((x) => x.id)).toEqual(['delivery_vehicles']);
    const r2no = planQuestionRound(PLAN_QUESTIONS, { delivery: 'no' }, new Set(handled));
    expect(r2no.ask).toEqual([]);
  });

  it('skips an optional question no source answered', () => {
    const handled = new Set<string>();
    const r = planQuestionRound([q({ id: 'opt', required: false })], {}, handled);
    expect(r.ask).toEqual([]);
    expect(handled.has('opt')).toBe(true);
  });

  it('still shows an optional question a source answered, so the insured can reject it', () => {
    const r = planQuestionRound([q({ id: 'opt', required: false, suggested: { value: 'x' } })], {}, new Set());
    expect(r.confirm.map((x) => x.id)).toEqual(['opt']);
  });
});

describe('checklistAnswers', () => {
  it('answers Yes for checked ids and No for the rest', () => {
    const items = [q({ id: 'a', type: 'yes_no' }), q({ id: 'b', type: 'yes_no' })];
    expect(checklistAnswers(items, ['b'])).toEqual({ a: 'no', b: 'yes' });
  });
});

describe('formatKnown', () => {
  it('shows a select option label and a yes/no word', () => {
    const sel = DEMO_QUESTIONS.find((x) => x.id === 'claims_5y')!;
    expect(formatKnown(sel, '0')).toBe('None');
    expect(formatKnown(q({ id: 'y', type: 'yes_no' }), 'yes')).toBe('Yes');
    expect(formatKnown(q({ id: 'y', type: 'yes_no' }), 'no')).toBe('No');
  });
});

// Real question set from a prod cyber session (carrier question text only, no
// customer data), captured 2026-09-23 for CHUBB + COALITION.
const FIXTURE = path.join(__dirname, 'fixtures', 'cyber-session-questions.json');

describe('prod cyber session prompt count', () => {
  it('collapses 99 questions into one checklist plus the required non-yes/no prompts', () => {
    const questions = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as InstantQuestion[];
    expect(questions).toHaveLength(99);
    const r1 = planQuestionRound(questions, {}, new Set());
    expect(r1.confirm).toHaveLength(0);
    expect(r1.checklist).toHaveLength(31);
    expect(r1.ask).toHaveLength(13);
  });
});

// QA e2e 2026-10-12 (ed2efb70): AmTrust's statement, a terrorism coverage
// disclosure, sat in "Check every statement that is TRUE for your business",
// was left unchecked (No), and AmTrust was dropped for an unaccepted statement.
describe('carrier statements', () => {
  const stmt = q({ id: 'ee3f02ba2c880d87', type: 'yes_no', label: 'TERRORISM COVERAGE\n\nPolicyholder Disclosure Notice', statement: { carriers: ['AMTRUST'] } });
  const fact = q({ id: 'franchise', type: 'yes_no', label: 'Do you operate under a franchise agreement?' });

  it('are asked one by one, never in the true-for-your-business checklist', () => {
    const r = planQuestionRound([stmt, fact], {}, new Set());
    expect(r.checklist.map((x) => x.id)).toEqual(['franchise']);
    expect(r.ask.map((x) => x.id)).toEqual(['ee3f02ba2c880d87']);
  });
});
