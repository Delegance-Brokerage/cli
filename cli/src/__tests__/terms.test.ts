import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

// eslint-disable-next-line import/first
import { DeleganceError } from '@delegance/sdk';
// eslint-disable-next-line import/first
import { confirmTerms, termsAcceptRefusal, termsLines } from '../commands/terms';
// eslint-disable-next-line import/first
import { isTermsRefusal, loadSignupTerms, nonInteractiveMissing, termsNotAcceptedMessage } from '../commands/signup';
// eslint-disable-next-line import/first
import { brokerReviewLines, brokerReviewResult, selfDirectedAckLines } from '../commands/commerce';

const TERMS = {
  version: '2026-09-24',
  termsUrl: 'https://portal.delegancebrokerage.com/terms',
  privacyUrl: 'https://portal.delegancebrokerage.com/privacy',
  slaUrl: 'https://portal.delegancebrokerage.com/sla',
  summaries: ['Self-directed placements (Section 9A): ...', 'Section 10 authorizes ...'],
  brokerReview: { email: 'support@delegancebrokerage.com', command: 'delegance bind <submissionId> <offerId> --broker-review' },
};

describe('termsLines', () => {
  it('shows the version, both links, then every summary with the self-directed one first', () => {
    const lines = termsLines(TERMS);
    expect(lines[0]).toContain('version 2026-09-24');
    expect(lines[0]).toContain(TERMS.termsUrl);
    expect(lines[1]).toContain(TERMS.privacyUrl);
    expect(lines[2]).toMatch(/Section 9A/);
    expect(lines).toHaveLength(4);
  });
});

describe('confirmTerms', () => {
  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

  it('the flag accepts, but only after the lines print', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const ask = vi.fn();
    expect(await confirmTerms(TERMS, { flag: true, interactive: false, ask })).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).toContain(TERMS.termsUrl);
  });

  it('a print override (JSON mode) receives every line instead of stdout', async () => {
    const seen: string[] = [];
    await confirmTerms(TERMS, { flag: true, interactive: false, print: (l) => seen.push(l) });
    expect(seen).toEqual(termsLines(TERMS));
  });

  it('with no terminal and no flag the answer is no', async () => {
    expect(await confirmTerms(TERMS, { flag: false, interactive: false, ask: async () => true })).toBe(false);
  });

  it('asks on a terminal and honours a no', async () => {
    expect(await confirmTerms(TERMS, { flag: false, interactive: true, ask: async () => false })).toBe(false);
    expect(await confirmTerms(TERMS, { flag: false, interactive: true, ask: async () => true })).toBe(true);
  });
});

describe('termsAcceptRefusal', () => {
  it('without a prompt (no terminal, or --json on a terminal) names --yes instead of reading as a decline', () => {
    const r = termsAcceptRefusal(false);
    expect(r.kind).toBe('error');
    expect(r.message).toContain('terms accept --yes');
  });

  it('after a real prompt the user said no', () => {
    const r = termsAcceptRefusal(true);
    expect(r.kind).toBe('warn');
    expect(r.message).toMatch(/Not accepted/);
  });
});

describe('npx-aware hints', () => {
  const saved = process.argv[1];
  afterEach(() => { process.argv[1] = saved; });

  it('the bind acknowledgment and the --yes hint repeat the npx form when launched through npx', () => {
    process.argv[1] = '/home/u/.npm/_npx/abc123/node_modules/@delegance/cli/dist/bin/delegance.js';
    expect(selfDirectedAckLines('sub_1', 'opp_1')[1]).toContain('npx -y @delegance/cli bind sub_1 opp_1 --broker-review');
    expect(termsAcceptRefusal(false).message).toContain('npx -y @delegance/cli terms accept --yes');
  });
});

describe('isTermsRefusal', () => {
  it('matches only the two Terms reasons', () => {
    const make = (reason: string) => Object.assign(new DeleganceError('x', 400), { reason });
    expect(isTermsRefusal(make('terms_not_accepted'))).toBe(true);
    expect(isTermsRefusal(make('terms_version_outdated'))).toBe(true);
    expect(isTermsRefusal(make('enrollment_exists'))).toBe(false);
    expect(isTermsRefusal(new Error('terms_not_accepted'))).toBe(false);
  });
});

describe('loadSignupTerms', () => {
  it('returns the Terms when the server serves them', async () => {
    await expect(loadSignupTerms(async () => TERMS)).resolves.toEqual(TERMS);
  });

  it('returns null when the server predates the Terms step (404), so signup still works against it', async () => {
    const r = await loadSignupTerms(async () => { throw new DeleganceError('Not found', 404); });
    expect(r).toBeNull();
  });

  it('rethrows every other failure: a 5xx or a network error is not "no Terms"', async () => {
    await expect(loadSignupTerms(async () => { throw new DeleganceError('boom', 503); })).rejects.toThrow('boom');
    await expect(loadSignupTerms(async () => { throw new Error('ECONNRESET'); })).rejects.toThrow('ECONNRESET');
  });
});

describe('nonInteractiveMissing', () => {
  const FULL = {
    email: 'ada@example.com', business: 'Ada Bakery', first: 'Ada', last: 'Lovelace', industry: 'bakery',
    size: '1-10', street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701',
  };

  it('requires --accept-terms when the server serves the Terms', () => {
    expect(nonInteractiveMissing(FULL, TERMS)).toEqual(['--accept-terms']);
    expect(nonInteractiveMissing({ ...FULL, acceptTerms: true }, TERMS)).toEqual([]);
  });

  it('keeps the legacy path against a server with no Terms step (404): no --accept-terms needed', () => {
    expect(nonInteractiveMissing(FULL, null)).toEqual([]);
  });

  it('still lists the missing fields, with --accept-terms last only when the Terms are served', () => {
    const { email: _e, ...noEmail } = FULL;
    const served = nonInteractiveMissing(noEmail, TERMS);
    expect(served[served.length - 1]).toBe('--accept-terms');
    expect(served.length).toBeGreaterThan(1);
    expect(nonInteractiveMissing(noEmail, null)).not.toContain('--accept-terms');
  });
});

describe('termsNotAcceptedMessage', () => {
  it('on signup, says nothing was created, since the Terms are asked before the account exists', () => {
    for (const interactive of [true, false]) {
      const msg = termsNotAcceptedMessage('signup', interactive);
      expect(msg).not.toMatch(/account exists/i);
    }
    expect(termsNotAcceptedMessage('signup', true)).toMatch(/Not signed up/);
    expect(termsNotAcceptedMessage('signup', false)).toMatch(/--accept-terms/);
  });

  it('on verify, says the account already exists and acceptance is still needed to finish setup', () => {
    for (const interactive of [true, false]) {
      const msg = termsNotAcceptedMessage('verify', interactive);
      expect(msg).toMatch(/account exists/i);
      expect(msg).toMatch(/finish/i);
      expect(msg).not.toMatch(/Not signed up|open an account/i);
      expect(msg).toMatch(/verify/);
    }
    expect(termsNotAcceptedMessage('verify', false)).toMatch(/verify --accept-terms/);
  });
});

describe('bind disclosure', () => {
  it('the acknowledgment names the self-directed placement and the broker-review command', () => {
    const [ack, offer] = selfDirectedAckLines('sub_1', 'opp_1');
    expect(ack).toMatch(/self-directed placement/);
    expect(ack).toMatch(/does not advise/);
    expect(offer).toContain('delegance bind sub_1 opp_1 --broker-review');
  });

  it('broker review binds nothing and gives a contact path with both ids', () => {
    const lines = brokerReviewLines('sub_1', 'opp_1');
    expect(lines[0]).toMatch(/Nothing was bound, and no review has been requested yet/);
    expect(lines.join(' ')).toContain('support@delegancebrokerage.com');
    expect(lines.join(' ')).toContain('mailto:support@delegancebrokerage.com?subject=');
    expect(lines.join(' ')).toContain('opp_1');
  });

  it('broker review in --json mode is one JSON document an agent can read', () => {
    const doc = brokerReviewResult('sub_1', 'opp_1');
    expect(doc.bound).toBe(false);
    expect(doc.reviewRequested).toBe(false);
    expect(doc.brokerReview.email).toBe('support@delegancebrokerage.com');
    expect(doc.brokerReview.mailto).toMatch(/^mailto:support@delegancebrokerage\.com\?subject=.*sub_1.*opp_1/);
    expect(doc.message).toEqual(brokerReviewLines('sub_1', 'opp_1'));
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow();
  });
});
