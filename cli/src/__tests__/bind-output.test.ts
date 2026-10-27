import { describe, it, expect, vi } from 'vitest';

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
import { describeBindResult, describeFinancing } from '../commands/commerce';

const base = { bindRequestId: 'b1', status: 'pending_review', carrierName: 'Coterie', coverage: 'professional_liability', premium: 480, existing: false, next: 'A licensed Delegance broker reviews the bind.' };

describe('describeBindResult', () => {
  it('tier A prints the checkout link and never says bound', () => {
    const lines = describeBindResult({ ...base, tier: 'A', status: 'carrier_checkout_started', checkoutUrl: 'https://proposal.coterieinsurance.com/x' });
    expect(lines[0]).toBe('Checkout opened with Coterie. Pay on their page to bind:');
    expect(lines[1]).toBe('https://proposal.coterieinsurance.com/x');
    expect(lines.join(' ')).toMatch(/not bound until the carrier confirms/);
  });

  it('tier C names why a broker reviews it', () => {
    expect(describeBindResult({ ...base, tier: 'C', reasons: ['link_host_not_allowed'] }))
      .toEqual(['A broker reviews this one (link host not allowed).', base.next]);
  });

  it('a pre-fast-bind reply prints only the next step', () => {
    expect(describeBindResult(base)).toEqual([base.next]);
  });
});

describe('summarizeBilling', () => {
  it('totals open (payable) and paid requests in cents', async () => {
    const { summarizeBilling } = await import('../commands/commerce');
    const p = (over: object) => ({ id: 'p', amount: 100, currency: 'usd', description: null, status: 'open', createdAt: '', payable: true, ...over });
    expect(summarizeBilling([p({ amount: 48000 }), p({ amount: 1000, status: 'paid', payable: false }), p({ amount: 5, status: 'void', payable: false })]))
      .toEqual({ openCents: 48000, paidCents: 1000, openCount: 1 });
  });
});

describe('describeFinancing', () => {
  const offer = {
    available: true,
    availability: 'precheck_passed' as const,
    provider: 'advance_afco',
    lender: 'AFCO (through Advance)',
    reason: null,
    checkoutUrl: 'https://portal.delegancebrokerage.com/portal/checkout/finance/b1',
    premiumFinal: true,
    terms: null,
    applicationStatus: null,
    disclosure: 'Financing is offered by AFCO (through Advance). The lender sets the APR, down payment and installments and shows them before you sign.',
  };

  it('prints nothing when financing is absent or unavailable', () => {
    expect(describeFinancing(undefined)).toEqual([]);
    expect(describeFinancing({ ...offer, available: false })).toEqual([]);
  });

  it('prints the link and the disclosure, and no terms before the lender reports them', () => {
    const lines = describeFinancing(offer);
    expect(lines[0]).toBe(`Pay over time with AFCO (through Advance): ${offer.checkoutUrl}`);
    expect(lines.join(' ')).not.toMatch(/Lender terms/);
  });

  it('says financing opens later while the premium is only quoted', () => {
    expect(describeFinancing({ ...offer, checkoutUrl: null, premiumFinal: false })[0]).toMatch(/opens once your broker confirms/);
  });

  it('prints the lender-reported terms verbatim', () => {
    const lines = describeFinancing({
      ...offer,
      terms: { aprBps: 1374, downPaymentCents: 62500, amountFinancedCents: 187500, financeChargeCents: 12010, installmentCents: 19951, numberOfInstallments: 10, totalOfPaymentsCents: 262010, agreementUrl: null, providerQuoteRef: 'Q', providerQuoteStatus: null },
    });
    expect(lines[1]).toMatch(/^Lender terms: 13\.74% APR, \$625\.00 down, 10 payments of \$199\.51\.$/);
  });
});

