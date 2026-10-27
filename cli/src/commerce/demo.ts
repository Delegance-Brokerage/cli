/**
 * The `--demo` walkthrough: a canned bakery quote that never touches the
 * server. Every premium is sample data and every table is labelled DEMO.
 */

import type { InstantQuestion, InstantQuoteStatus } from '@delegance/sdk';

export const DEMO_BUSINESS = 'Riverbend Bakery (demo), Austin TX';

/** Short labels for the sample-answers block a non-interactive demo prints. */
export const DEMO_SHORT_LABELS: Record<string, string> = {
  annual_revenue: 'Annual revenue',
  employees: 'Full-time employees',
  delivery: 'Delivers orders',
  delivery_vehicles: 'Delivery vehicles',
  claims_5y: 'Claims in last 5 years',
};

export const DEMO_QUESTIONS: InstantQuestion[] = [
  { id: 'annual_revenue', label: 'Annual revenue (USD)', type: 'currency', required: true, prefill: 850000 },
  { id: 'employees', label: 'Full-time employees', type: 'number', required: true, prefill: 6 },
  {
    id: 'delivery',
    label: 'Do you deliver orders to customers?',
    type: 'yes_no',
    required: true,
    prefill: 'no',
  },
  {
    id: 'delivery_vehicles',
    label: 'How many vehicles make deliveries?',
    type: 'number',
    required: false,
    requiredIfShown: true,
    showIf: { questionId: 'delivery', equals: ['yes'] },
  },
  {
    id: 'claims_5y',
    label: 'Claims in the last 5 years',
    type: 'select',
    required: true,
    options: [
      { value: '0', label: 'None' },
      { value: '1', label: 'One' },
      { value: '2+', label: 'Two or more' },
    ],
    prefill: '0',
  },
];

/** Carrier quotes as newer servers send them: limits and deductible included. */
type DemoCarrierQuote = InstantQuoteStatus['carrierQuotes'][number] & { limits: string | null; deductible: number | null };

export const DEMO_STATUS: InstantQuoteStatus & { effectiveDate: string; carrierQuotes: DemoCarrierQuote[] } = {
  submissionId: 'demo-submission',
  effectiveDate: '2026-11-01',
  coverages: ['general_liability', 'workers_comp'],
  expiresAt: null,
  submitted: true,
  submitStatus: 'completed',
  allCarriersResolved: true,
  awaitingBrokerReviewCount: 0,
  carrierQuotes: [
    { opportunityId: 'demo-1', carrierId: 'CARRIER_A', carrierName: 'Carrier A', coverage: 'CGL', state: 'QUOTED', marketStatus: 'quote', premium: 612, quoteNumber: 'DEMO-GL-1', bindable: true, limits: '$1M per occurrence / $2M aggregate', deductible: 500 },
    { opportunityId: 'demo-2', carrierId: 'CARRIER_B', carrierName: 'Carrier B', coverage: 'CGL', state: 'QUOTED', marketStatus: 'quote', premium: 748, quoteNumber: 'DEMO-GL-2', bindable: true, limits: '$1M per occurrence / $2M aggregate', deductible: 1000 },
    { opportunityId: 'demo-3', carrierId: 'CARRIER_C', carrierName: 'Carrier C', coverage: 'WC', state: 'QUOTED', marketStatus: 'quote', premium: 1184, quoteNumber: 'DEMO-WC-1', bindable: true, limits: 'Statutory / $1M employers liability', deductible: 0 },
    { opportunityId: 'demo-4', carrierId: 'CARRIER_D', carrierName: 'Carrier D', coverage: 'WC', state: 'DECLINED', marketStatus: 'declined', premium: null, quoteNumber: null, bindable: false, limits: null, deductible: null },
  ],
};
