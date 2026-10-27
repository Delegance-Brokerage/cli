/**
 * Bonds Module: surety bond quotes.
 *
 * `start` matches the bond and returns its questions, `answer` submits them
 * (starting pricing when complete), `status` returns the premium and the
 * surety's apply link. Buying a bond is never automated: a quoted bond hands
 * off to the surety's apply page.
 *
 * Responses pass through the bond quote service as-is (snake_case fields such
 * as `session_id`, `missing_required`, `apply_url`).
 */

import { randomUUID } from 'crypto';
import { HttpClient } from '../utils/http';

export interface StartBondQuoteInput {
  /** Two-letter state, e.g. 'TX'. */
  state?: string;
  /** Bond name or keyword, e.g. 'notary', 'contractor license'. */
  bondName?: string;
  entityId?: string;
  contractAmount?: string | number;
  bondAmount?: string | number;
}

export type BondToolResult = Record<string, unknown>;

export class BondsModule {
  constructor(private http: HttpClient) {}

  async start(input: StartBondQuoteInput): Promise<BondToolResult> {
    const res = await this.http.request<{ data: BondToolResult }>({ method: 'POST', path: '/api/v1/bonds/quote', body: input });
    return res.data;
  }

  async answer(sessionId: string, answers: Record<string, unknown>, opts: { idempotencyKey?: string } = {}): Promise<BondToolResult> {
    const res = await this.http.request<{ data: BondToolResult }>({
      method: 'POST',
      path: `/api/v1/bonds/quote/${encodeURIComponent(sessionId)}/answers`,
      body: { answers },
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
    return res.data;
  }

  async status(sessionId: string): Promise<BondToolResult> {
    const res = await this.http.request<{ data: BondToolResult }>({
      method: 'GET',
      path: `/api/v1/bonds/quote/${encodeURIComponent(sessionId)}`,
    });
    return res.data;
  }
}
