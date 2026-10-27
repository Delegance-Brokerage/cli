/**
 * Payments Module: premium payment requests and Stripe checkout links.
 *
 * A payment request exists after a broker reviews a bind and records the
 * carrier's final premium. `checkout` returns a hosted Stripe URL to pay it.
 */

import { randomUUID } from 'crypto';
import { HttpClient } from '../utils/http';

export interface PaymentRequest {
  id: string;
  /** Cents. */
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  dueDate?: string;
  createdAt: string;
  payable: boolean;
}

export class PaymentsModule {
  constructor(private http: HttpClient) {}

  async list(): Promise<PaymentRequest[]> {
    const res = await this.http.request<{ data: { payments: PaymentRequest[] } }>({ method: 'GET', path: '/api/v1/payments' });
    return res.data.payments;
  }

  async checkout(paymentRequestId: string, opts: { idempotencyKey?: string } = {}): Promise<{ checkoutUrl: string }> {
    const res = await this.http.request<{ data: { checkoutUrl: string } }>({
      method: 'POST',
      path: `/api/v1/payments/${encodeURIComponent(paymentRequestId)}/checkout`,
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
    return res.data;
  }
}
