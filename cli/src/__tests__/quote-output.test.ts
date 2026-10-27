/**
 * The quote results a person reads: per-coverage best price, spelled-out
 * coverage names, plain status words, the compact table, the "run this next"
 * hints in the form the person launched, and the non-interactive demo.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CarrierQuote, InstantQuoteStatus } from '@delegance/sdk';

vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

// eslint-disable-next-line import-x/first -- after vi.mock
import { DeleganceError } from '@delegance/sdk';
import { bestPerCoverage, groupRowsByCoverage, quoteStatusWord, sortQuoteRows } from '../commerce/questions';
// eslint-disable-next-line import-x/first -- after vi.mock
import { coverageName, coverageNames } from '../utils/coverage-names';
// eslint-disable-next-line import-x/first -- after vi.mock
import { cliInvocation, NPX_INVOCATION } from '../utils/invocation';
// eslint-disable-next-line import-x/first -- after vi.mock
import { formatDateOnly, renderCompactTable, table } from '../utils/output';
// eslint-disable-next-line import-x/first -- after vi.mock
import {
  AGENT_TIP, activeRequestLines, floorDropLines, handoffLines, printQuoteTable, runDemo, withheldLines,
} from '../commands/instant-quote';
// eslint-disable-next-line import-x/first -- after vi.mock

// eslint-disable-next-line no-control-regex -- strip SGR color codes
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');

function captureLog(fn: () => void | Promise<void>): Promise<string> {
  const out: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(' ')); });
  const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { out.push(a.map(String).join(' ')); });
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => { out.push(String(chunk)); return true; }));
  return Promise.resolve(fn()).then(() => strip(out.join('\n'))).finally(() => {
    log.mockRestore();
    err.mockRestore();
    stderr.mockRestore();
  });
}

const quote = (o: Partial<CarrierQuote> & Pick<CarrierQuote, 'opportunityId' | 'carrierName' | 'coverage'>): CarrierQuote => ({
  carrierId: o.carrierName.toUpperCase(),
  state: 'QUOTED',
  marketStatus: 'quote',
  premium: null,
  quoteNumber: null,
  bindable: true,
  ...o,
});

// WC is cheaper than the best GL here only if prices are compared across coverages.
const MIXED: CarrierQuote[] = [
  quote({ opportunityId: 'gl-hi', carrierName: 'Carrier B', coverage: 'CGL', premium: 900 }),
  quote({ opportunityId: 'wc-lo', carrierName: 'Carrier C', coverage: 'WC', premium: 300 }),
  quote({ opportunityId: 'gl-lo', carrierName: 'Carrier A', coverage: 'CGL', premium: 610 }),
  quote({ opportunityId: 'wc-hi', carrierName: 'Carrier D', coverage: 'WC', premium: 450 }),
  quote({ opportunityId: 'wc-dec', carrierName: 'Carrier E', coverage: 'WC', premium: 100, state: 'DECLINED', marketStatus: 'declined', bindable: false }),
  quote({ opportunityId: 'gl-nb', carrierName: 'Carrier F', coverage: 'CGL', premium: 50, bindable: false }),
];

describe('bestPerCoverage', () => {
  it('picks the cheapest bindable offer within each coverage, never across them', () => {
    const best = bestPerCoverage(sortQuoteRows(MIXED));
    expect(best.map((r) => r.opportunityId)).toEqual(['wc-lo', 'gl-lo']);
  });
  it('leaves out declined and non-bindable rows even when they carry a lower price', () => {
    const ids = bestPerCoverage(sortQuoteRows(MIXED)).map((r) => r.opportunityId);
    expect(ids).not.toContain('wc-dec');
    expect(ids).not.toContain('gl-nb');
  });
  it('treats codes that name the same coverage as one coverage', () => {
    const best = bestPerCoverage(sortQuoteRows([
      quote({ opportunityId: 'a', carrierName: 'A', coverage: 'CGL', premium: 700 }),
      quote({ opportunityId: 'b', carrierName: 'B', coverage: 'general_liability', premium: 650 }),
    ]));
    expect(best.map((r) => r.opportunityId)).toEqual(['b']);
  });
  it('omits a coverage with no bindable price', () => {
    const best = bestPerCoverage(sortQuoteRows([
      quote({ opportunityId: 'wc-dec', carrierName: 'E', coverage: 'WC', state: 'DECLINED', marketStatus: 'declined', bindable: false }),
    ]));
    expect(best).toEqual([]);
  });
});

describe('groupRowsByCoverage', () => {
  it('keeps each coverage together, in the order of its first row', () => {
    const rows = groupRowsByCoverage(sortQuoteRows(MIXED));
    expect(rows.map((r) => r.coverage)).toEqual(['WC', 'WC', 'WC', 'CGL', 'CGL', 'CGL']);
  });
});

describe('coverageName', () => {
  it('spells out carrier-quote policy types', () => {
    expect(coverageName('CGL')).toBe('General Liability');
    expect(coverageName('WC')).toBe("Workers' Comp");
    expect(coverageName('BOP')).toBe("Business Owner's Policy");
    expect(coverageName('CYBER')).toBe('Cyber');
    expect(coverageName('MPL')).toBe('Professional Liability (E&O)');
    expect(coverageName('BR')).toBe("Builders' Risk");
    expect(coverageName('CA')).toBe('Commercial Auto');
  });
  it('spells out the quote coverage ids and canonical LOB codes', () => {
    expect(coverageName('general_liability')).toBe('General Liability');
    expect(coverageName('workers_comp')).toBe("Workers' Comp");
    expect(coverageName('workers_compensation')).toBe("Workers' Comp");
    expect(coverageName('business_owners')).toBe("Business Owner's Policy");
    expect(coverageName('COMMERCIAL_UMBRELLA')).toBe('Umbrella');
    expect(coverageName('tech_eo')).toBe('Tech E&O');
    expect(coverageName('KIDNAP_RANSOM')).toBe('Kidnap and Ransom');
    expect(coverageName('e&o')).toBe('Professional Liability (E&O)');
  });
  it('passes unknown codes through unchanged', () => {
    expect(coverageName('SPACE_DEBRIS')).toBe('SPACE_DEBRIS');
    expect(coverageName('')).toBe('');
    expect(coverageName(null)).toBe('');
  });
  it('joins a list', () => {
    expect(coverageNames(['general_liability', 'WC'])).toBe("General Liability, Workers' Comp");
  });
});

describe('quoteStatusWord', () => {
  it('turns server states into words', () => {
    expect(quoteStatusWord('quote')).toBe('Quoted');
    expect(quoteStatusWord('declined')).toBe('Declined');
    expect(quoteStatusWord('DECLINED')).toBe('Declined');
    expect(quoteStatusWord('QUOTING')).toBe('Pricing');
    expect(quoteStatusWord('some_new_state')).toBe('Some new state');
    expect(quoteStatusWord('referred')).toBe('Referred to an underwriter');
    expect(quoteStatusWord('needs_info')).toBe('Needs more info');
  });
});

// Prod 2026-10-08 (submission 49450164): the server's marketStatus folds
// REFERRED into `pending`, so a closed CHUBB referral and a CNA needs-info row
// both read "Pricing" and the decline reasons never showed.
describe('REFERRED and declined rows (prod 2026-10-08)', () => {
  const rows = [
    quote({ opportunityId: 'chubb', carrierName: 'Chubb', coverage: 'GL', state: 'REFERRED', marketStatus: 'pending', bindable: null, resultStatus: 'needs_info', message: 'Chubb needs more information before it can quote: answers to the required underwriting questions.' }),
    quote({ opportunityId: 'cna', carrierName: 'CNA', coverage: 'CGL', state: 'REFERRED', marketStatus: 'pending', bindable: null }),
    quote({ opportunityId: 'coterie', carrierName: 'Coterie', coverage: 'GL', state: 'DECLINED', marketStatus: 'declined', bindable: null, resultStatus: 'declined', message: 'E0122: Producer is not licensed in WA' }),
  ];

  it('never shows a REFERRED row as Pricing', () => {
    const byId = Object.fromEntries(sortQuoteRows(rows).map((r) => [r.opportunityId, quoteStatusWord(r.status)]));
    expect(byId).toEqual({ chubb: 'Needs more info', cna: 'Referred to an underwriter', coterie: 'Declined' });
  });

  it('prints each carrier reason under the table, and an older server (no message) prints none', async () => {
    const status: InstantQuoteStatus = {
      submissionId: 'sub-1', coverages: ['general_liability'], expiresAt: null, submitted: true,
      submitStatus: 'completed', allCarriersResolved: true, awaitingBrokerReviewCount: 0, carrierQuotes: rows,
    };
    const out = await captureLog(() => printQuoteTable(status));
    expect(out).not.toContain('Pricing');
    expect(out).toContain('Coterie (Declined): E0122: Producer is not licensed in WA');
    expect(out).toContain('Chubb (Needs more info): Chubb needs more information');
    expect(out).not.toMatch(/^CNA \(/m);
  });
});

// Prod 2026-10-12, submission 1f5e6f4d: `quote start` listed CHUBB, CNA,
// COTERIE; the floors held CNA back and the table showed only two carriers.
describe('carriers the submit held back', () => {
  const offers = [
    quote({ opportunityId: 'o-chubb', carrierName: 'Chubb', coverage: 'GL', premium: 900 }),
    quote({ opportunityId: 'o-coterie', carrierName: 'Coterie', coverage: 'GL', premium: 700 }),
  ];
  const status: InstantQuoteStatus = {
    submissionId: 'sub-1', coverages: ['general_liability'], expiresAt: null, submitted: true,
    submitStatus: 'completed', allCarriersResolved: true, awaitingBrokerReviewCount: 0, carrierQuotes: offers,
    withheldCarriers: [{
      carrierId: 'CNA', carrierName: 'CNA', status: 'needs_info',
      needs: ['building area', 'construction type'], message: 'CNA: needs building area, construction type',
    }],
  };

  it('names the carrier and what it needs under the table, with the re-quote command', async () => {
    const out = await captureLog(() => printQuoteTable(status));
    expect(out).toContain('CNA: needs building area, construction type');
    expect(out).toContain('quote start --coverage general_liability --replace');
    expect(out).toContain('1 not sent');
  });

  it('still names it when no carrier has an offer yet', async () => {
    const out = await captureLog(() => printQuoteTable({ ...status, carrierQuotes: [] }));
    expect(out).toContain('CNA: needs building area, construction type');
  });

  it('prints nothing extra for an older server', () => {
    expect(withheldLines({ coverages: ['general_liability'] })).toEqual([]);
  });

  it('groups the submit-time floor drops per carrier', () => {
    const lines = floorDropLines([
      { carrierId: 'CNA', reason: 'requirement_floor:cna_cgl_building_area', missing: 'Square footage of your business premises' },
      { carrierId: 'CNA', reason: 'requirement_floor:cna_cgl_construction_type', missing: 'Construction type of your building' },
      { carrierId: 'CHUBB', reason: 'missing:history.bankruptcy' },
    ], 'gl');
    expect(lines).toEqual([
      'Not sent to these carriers, because a fact they need is missing:',
      '  - CNA: needs Square footage of your business premises; Construction type of your building',
      expect.stringContaining('quote start --coverage gl --replace'),
    ]);
  });

  it('names the drops but offers no --replace when the coverage is unknown or a handoff follows', () => {
    const lines = floorDropLines([
      { carrierId: 'CNA', reason: 'requirement_floor:cna_cgl_building_area', missing: 'Square footage' },
    ], '');
    expect(lines).toEqual([
      'Not sent to these carriers, because a fact they need is missing:',
      '  - CNA: needs Square footage',
    ]);
  });

  it('does not offer a carrier a contract requirement excludes as fixable', () => {
    expect(floorDropLines([
      { carrierId: 'CNA', reason: 'requirement_floor:cna_cgl_building_area', missing: 'Square footage' },
      { carrierId: 'CNA', reason: 'requirement:am_best_below:Acme Landlord' },
    ], 'gl')).toEqual([]);
  });

  // QA 2026-10-12, b2c3f58d: a newer server also lists the held-back
  // carrier as a result row, so it shows in the table itself.
  it('shows a withheld row in the table with no offer id, and prints its reason once', async () => {
    const sentence = 'CNA needs more information before it can quote: Square footage of your business premises.';
    const withRow: InstantQuoteStatus = {
      ...status,
      carrierQuotes: [
        ...offers,
        {
          ...quote({ opportunityId: '', carrierName: 'CNA', coverage: 'general_liability', premium: null }),
          carrierId: 'CNA', state: 'REFERRED', marketStatus: 'needs_info', bindable: false,
          resultStatus: 'needs_info', message: sentence, withheld: true,
        },
      ],
      withheldCarriers: [{ ...status.withheldCarriers![0], message: sentence }],
    };
    const out = await captureLog(() => printQuoteTable(withRow));
    expect(out).toContain('Needs more info');
    expect(out.split(sentence).length - 1).toBe(1);
    expect(out).toContain('quote start --coverage general_liability --replace');
    // Counted as not sent, never as an unpriced offer.
    expect(out).toContain('2 of 2 carriers priced, 1 not sent');
  });

  it('offers no --replace once a broker has the request', () => {
    const withBroker: InstantQuoteStatus = {
      ...status, carrierQuotes: [], brokerReview: { taskId: 't-1', status: 'in_review', createdAt: '2026-10-12T00:00:00Z' },
    };
    const lines = withheldLines(withBroker);
    expect(lines).toContain('  CNA: needs building area, construction type');
    expect(lines.join('\n')).not.toContain('--replace');
    expect(withheldLines({ ...status, awaitingBrokerReviewCount: 1 }).join('\n')).not.toContain('--replace');
  });
});

describe('cliInvocation', () => {
  it('repeats the npx form when launched from the npx cache', () => {
    expect(cliInvocation({}, ['node', '/Users/x/.npm/_npx/abc123/node_modules/.bin/delegance'])).toBe(NPX_INVOCATION);
  });
  it('repeats the npx form for `npx delegance` against a local install', () => {
    expect(cliInvocation({ npm_command: 'exec' }, ['node', '/proj/node_modules/@delegance/cli/dist/bin/delegance.js'])).toBe('npx -y @delegance/cli');
  });
  it('says `delegance` for a global install', () => {
    expect(cliInvocation({}, ['node', '/usr/local/bin/delegance'])).toBe('delegance');
    expect(cliInvocation({ npm_command: 'run-script' }, ['node', '/usr/local/lib/node_modules/@delegance/cli/dist/bin/delegance.js'])).toBe('delegance');
  });
  it('ignores npm exec for a different program (a test runner)', () => {
    expect(cliInvocation({ npm_command: 'exec' }, ['node', '/proj/node_modules/vitest/vitest.mjs'])).toBe('delegance');
  });
});

describe('hints repeat the npx form when the CLI ran through npx', () => {
  it('quote status, re-quote and bind hints all say npx -y @delegance/cli', async () => {
    const argv1 = process.argv[1];
    process.argv[1] = '/Users/x/.npm/_npx/abc123/node_modules/.bin/delegance';
    try {
      expect(handoffLines({ submissionId: 's1', unansweredRequired: 0, alreadyHandedOff: true }).at(-1))
        .toBe('Check it: npx -y @delegance/cli quote status s1');
      const conflict = new DeleganceError('answers_changed_requote_required', 409, 't1');
      conflict.body = { message: 'answers_changed_requote_required' };
      expect(activeRequestLines(conflict, 'gl')?.[1]).toBe('Re-quote with the new answers: npx -y @delegance/cli quote start --coverage gl --replace');
      const out = await captureLog(() => printQuoteTable({
        submissionId: 'sub-1', coverages: ['general_liability'], expiresAt: null, submitted: true, submitStatus: 'completed',
        allCarriersResolved: true, awaitingBrokerReviewCount: 0,
        carrierQuotes: [quote({ opportunityId: 'o1', carrierName: 'A', coverage: 'CGL', premium: 500 })],
      }));
      expect(out).toContain('Bind it: npx -y @delegance/cli bind sub-1 o1');
      expect(out).not.toMatch(/(^|\s)delegance bind/m);
    } finally {
      process.argv[1] = argv1;
    }
  });
});

describe('compact table', () => {
  const headers = ['Carrier', 'Premium/yr'];
  const rows = [['Carrier A', '$612'], ['Carrier B', '$748'], ['Carrier C', '-']];

  it('prints a header, one rule line and the rows, with no dividers or borders', () => {
    const lines = strip(renderCompactTable(headers, rows)).split('\n');
    expect(lines).toHaveLength(2 + rows.length);
    expect(lines[1]).toMatch(/^ {2}─+ {2}─+$/);
    lines.slice(2).forEach((l) => expect(l).not.toMatch(/[─│┼├┤┌┐└┘]/));
    expect(lines[2]).toBe('  Carrier A  $612');
  });

  it('table(..., { compact: true }) prints that light style', async () => {
    const out = await captureLog(() => table(headers, rows, { compact: true }));
    const lines = out.split('\n');
    expect(lines).toHaveLength(2 + rows.length);
    expect(out).not.toMatch(/[│┌└├]/);
  });
});

describe('formatDateOnly', () => {
  it('formats the date part only, with no time-zone drift', () => {
    expect(formatDateOnly('2026-11-01')).toBe('Nov 1, 2026');
    expect(formatDateOnly('2026-11-01T00:00:00Z')).toBe('Nov 1, 2026');
    expect(formatDateOnly('2026-01-31T23:59:59-10:00')).toBe('Jan 31, 2026');
    expect(formatDateOnly('soon')).toBe('soon');
  });
});

describe('printQuoteTable (real quote)', () => {
  const status: InstantQuoteStatus = {
    submissionId: 'sub-9',
    coverages: ['general_liability', 'workers_comp'],
    expiresAt: null,
    submitted: true,
    submitStatus: 'completed',
    allCarriersResolved: true,
    awaitingBrokerReviewCount: 0,
    carrierQuotes: MIXED,
  };

  it('shows the best price per coverage, spelled-out names, words for status, and a bind command per best', async () => {
    const out = await captureLog(() => printQuoteTable(status));
    expect(out).toContain('Best price you can bind now:');
    expect(out).toContain('Cheaper General Liability: Carrier F $50/yr, bind through Delegance');
    expect(out).toMatch(/Workers' Comp\s+Carrier C\s+\$300\/yr/);
    expect(out).toMatch(/General Liability\s+Carrier A\s+\$610\/yr/);
    expect(out).not.toMatch(/Cheapest/);
    expect(out).not.toMatch(/\bCGL\b|\bWC\b/);
    expect(out).toContain('Declined');
    expect(out).not.toMatch(/\bquote\b|\bdeclined\b/);
    expect(out).toContain("Bind Workers' Comp: delegance bind sub-9 wc-lo");
    expect(out).toContain('Bind General Liability: delegance bind sub-9 gl-lo');
  });

  // QA 2026-10-13, submission 6bae4865 (TX bakery, BOP): the CLI printed
  // "Best price per coverage: COTERIE $2,789" while Chubb quoted $2,610, and
  // showed CNA/GAIG/Nationwide outages as Declined.
  it('names a cheaper quote that binds through Delegance, says how each row binds, and calls an outage unavailable', async () => {
    const bakery: InstantQuoteStatus = {
      ...status,
      coverages: ['business_owners'],
      carrierQuotes: [
        quote({ opportunityId: 'chubb', carrierName: 'CHUBB', coverage: 'BOP', premium: 2610, bindable: false }),
        quote({ opportunityId: 'coterie', carrierName: 'COTERIE', coverage: 'BOP', premium: 2789, bindable: true }),
        quote({ opportunityId: 'trv', carrierName: 'TRAVELERS', coverage: 'BOP', premium: 3460, bindable: false }),
        quote({ opportunityId: 'cna', carrierName: 'CNA', coverage: 'BOP', state: 'DECLINED', marketStatus: 'declined', bindable: false, resultStatus: 'carrier_unavailable', message: null }),
        quote({ opportunityId: 'old', carrierName: 'GAIG', coverage: 'BOP', state: 'DECLINED', marketStatus: 'declined', bindable: false }),
      ],
    };
    const out = await captureLog(() => printQuoteTable(bakery));
    expect(out).toMatch(/Best price you can bind now:\n\s+Business Owner's Policy\s+COTERIE\s+\$2,789\/yr/);
    expect(out).toContain('Cheaper: CHUBB $2,610/yr, bind through Delegance');
    expect(out).not.toContain('TRAVELERS $3,460/yr, bind');
    const cell = (id: string): string => out.split('\n').find((l) => l.includes(` ${id}`))!;
    expect(cell('coterie')).toContain('Quoted, bind online');
    expect(cell('chubb')).toContain('Quoted, bind through Delegance');
    expect(cell('cna')).toContain('Carrier unavailable, retry later');
    // An older server sends no resultStatus: the row keeps today's word.
    expect(cell('old')).toContain('Declined');
    expect(out).toContain('1 unavailable');
    expect(out).toContain('Bind it: delegance bind sub-9 coterie');
  });

  it('with no bindable price, lists the cheapest quote as bind through Delegance and prints no bind command', async () => {
    const out = await captureLog(() => printQuoteTable({
      ...status,
      carrierQuotes: [
        quote({ opportunityId: 'chubb', carrierName: 'CHUBB', coverage: 'BOP', premium: 2610, bindable: false }),
        quote({ opportunityId: 'trv', carrierName: 'TRAVELERS', coverage: 'BOP', premium: 3460, bindable: false }),
      ],
    }));
    expect(out).not.toContain('Best price you can bind now');
    expect(out).toContain('Quoted: CHUBB $2,610/yr, bind through Delegance');
    expect(out).not.toContain('delegance bind sub-9');
  });

  it('prints "-" for limits and deductible the server did not send, and the start date when it did', async () => {
    const out = await captureLog(() => printQuoteTable({ ...status, effectiveDate: '2026-11-01' }));
    expect(out).toContain('Coverage starts Nov 1, 2026');
    const row = out.split('\n').find((l) => l.includes('gl-hi'))!;
    expect(row).toMatch(/\$900\s+-\s+-\s+Quoted, bind online\s+gl-hi/);
  });
});

// 2026-10-08: a GL submit where Chubb and CNA referred to an underwriter and
// Coterie declined listed both referrals as pending and said "still waiting".
const REFERRAL_STATUS: InstantQuoteStatus = {
  submissionId: 'sub-ref',
  coverages: ['general_liability'],
  expiresAt: null,
  submitted: true,
  submitStatus: 'completed',
  allCarriersResolved: true,
  awaitingBrokerReviewCount: 0,
  carrierQuotes: [
    quote({ opportunityId: 'o-cot', carrierName: 'Coterie', coverage: 'CGL', state: 'DECLINED', marketStatus: 'declined', bindable: false, outcome: 'declined' }),
    quote({ opportunityId: 'o-chubb', carrierName: 'Chubb', coverage: 'CGL', state: 'REFERRED', marketStatus: 'pending', bindable: false, outcome: 'referred' }),
    quote({ opportunityId: 'o-cna', carrierName: 'CNA', coverage: 'CGL', state: 'REFERRED', marketStatus: 'pending', bindable: false, outcome: 'referred' }),
  ],
};

describe('printQuoteTable (referred carriers)', () => {
  it('shows Referred, counts referrals, and says Delegance follows up instead of still waiting', async () => {
    const out = await captureLog(() => printQuoteTable(REFERRAL_STATUS));
    expect(out).toMatch(/Chubb\s+General Liability.*Referred to an underwriter\s+o-chubb/);
    expect(out).toMatch(/CNA\s+General Liability.*Referred to an underwriter\s+o-cna/);
    expect(out).toMatch(/Coterie\s+General Liability.*Declined\s+o-cot/);
    expect(out).not.toMatch(/Pricing|pending/);
    expect(out).toContain('0 of 3 carriers priced, 1 declined, 2 with an underwriter.');
    expect(out).not.toMatch(/still waiting/);
    expect(out).toContain('Chubb and CNA sent this to an underwriter instead of pricing it instantly. Delegance follows up with you.');
  });

  it('reads referrals from state on an older server that sends no outcome and still counts them unresolved', async () => {
    const old: InstantQuoteStatus = {
      ...REFERRAL_STATUS,
      allCarriersResolved: false,
      carrierQuotes: REFERRAL_STATUS.carrierQuotes.map(({ outcome: _drop, ...q }) => q as CarrierQuote),
    };
    const out = await captureLog(() => printQuoteTable(old));
    expect(out).toMatch(/Chubb\s+General Liability.*Referred to an underwriter\s+o-chubb/);
    expect(out).toContain('0 of 3 carriers priced, 1 declined, 2 with an underwriter.');
    expect(out).not.toMatch(/still waiting/);
  });
});

describe('demo without a terminal', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints the sample answers it assumed, the table, the next step and the agent tip', async () => {
    const stdinTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
    try {
      const out = await captureLog(() => runDemo(false));
      expect(out).toContain('DEMO quote for Riverbend Bakery (demo), Austin TX. Nothing leaves this machine.');
      expect(out).toContain('Sample answers (a real quote asks you these):');
      expect(out).toMatch(/Annual revenue\s+\$850,000/);
      expect(out).toMatch(/Full-time employees\s+6/);
      expect(out).toMatch(/Delivers orders\s+No/);
      expect(out).toMatch(/Claims in last 5 years\s+None/);
      expect(out).toMatch(/Coverage starts\s+Nov 1, 2026/);
      expect(out).toMatch(/Carrier A\s+General Liability\s+\$612\s+\$1M per occurrence \/ \$2M aggregate\s+\$500\s+Quoted, bind online\s+demo-1/);
      expect(out).toMatch(/Carrier C\s+Workers' Comp\s+\$1,184\s+Statutory \/ \$1M employers liability\s+None\s+Quoted, bind online\s+demo-3/);
      expect(out).toContain('3 of 4 carriers priced, 1 declined.');
      expect(out).toContain('Next, on a real quote: delegance bind <quote id> <offer>   (e.g. bind ... demo-1)');
      expect(out).toContain('DEMO: sample premiums, nothing went to a carrier.');
      expect(out).toContain('Get real quotes: delegance signup');
      expect(out).toContain(AGENT_TIP);
      expect(AGENT_TIP).toMatch(/Claude Code, Codex, Gemini CLI or any coding agent/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: stdinTTY, configurable: true });
    }
  }, 10_000);
});
