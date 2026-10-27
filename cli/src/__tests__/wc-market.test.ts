import { describe, it, expect } from 'vitest';
import { wcMarketLines } from '../commerce/wc-market';

describe('wcMarketLines', () => {
  it('prints nothing when the session carries no wcMarket (older server, non-WC quote)', () => {
    expect(wcMarketLines({ submissionId: 's' })).toEqual([]);
    expect(wcMarketLines(null)).toEqual([]);
  });

  it('leads with the skip message, then one line per state, for a monopolistic-only insured', () => {
    const lines = wcMarketLines({
      wcMarket: {
        states: [{ summary: 'Ohio: workers\' comp comes only from the Ohio BWC, not a private carrier.' }],
        privateWcQuote: 'skipped',
        message: 'Workers\' comp in Ohio (Ohio BWC) comes only from the state fund, so no private workers\' comp quote was requested.',
        unknownStates: [],
      },
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/no private workers' comp quote/);
    expect(lines[1]).toMatch(/^Ohio:/);
  });

  it('prints the per-state lines without a skip message when private WC is requested', () => {
    const lines = wcMarketLines({
      wcMarket: {
        states: [{ summary: 'Indiana: private carriers write workers\' comp.' }],
        privateWcQuote: 'requested',
        message: null,
        unknownStates: ['ZZ'],
      },
    });
    expect(lines).toEqual([
      'Indiana: private carriers write workers\' comp.',
      'Unrecognized state on file: ZZ. A broker will confirm it.',
    ]);
  });

  it('says the state rules were not checked when no state is on file', () => {
    const lines = wcMarketLines({ wcMarket: { states: [], privateWcQuote: 'requested', message: null, unknownStates: [] } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/No business address on file/);
  });
});
