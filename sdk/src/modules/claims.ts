/**
 * Claims Module: file and track claims.
 *
 * Needs a key with the `claims:write` scope, minted by `delegance signup` or
 * by a signed-in portal user. The claims disclaimer must be accepted once in
 * the portal by the key's user; until then `file` throws with
 * reason `gate_not_acknowledged` and `body.portalUrl`.
 */

import { randomUUID } from 'crypto';
import { HttpClient } from '../utils/http';

export interface ClaimSummary {
  claimId: string;
  status: 'open' | 'in_progress' | 'resolved' | string;
  summary: string | null;
  incidentDate: string | null;
  policyId: string | null;
  openedAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
}

export interface FileClaimInput {
  description: string;
  /** YYYY-MM-DD. */
  incidentDate?: string;
  policyId?: string;
}

export class ClaimsModule {
  constructor(private http: HttpClient) {}

  async file(input: FileClaimInput, opts: { idempotencyKey?: string } = {}): Promise<ClaimSummary & { created: boolean; portalUrl: string; message: string }> {
    const res = await this.http.request<{ data: ClaimSummary & { created: boolean; portalUrl: string; message: string } }>({
      method: 'POST',
      path: '/api/v1/claims',
      body: input,
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
    return res.data;
  }

  async list(opts: { status?: 'open' | 'in_progress' | 'resolved'; limit?: number } = {}): Promise<ClaimSummary[]> {
    const q = new URLSearchParams();
    if (opts.status) q.set('status', opts.status);
    if (opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    const res = await this.http.request<{ data: { claims: ClaimSummary[] } }>({ method: 'GET', path: `/api/v1/claims${qs ? `?${qs}` : ''}` });
    return res.data.claims;
  }

  async get(claimId: string): Promise<ClaimSummary> {
    const res = await this.http.request<{ data: ClaimSummary }>({ method: 'GET', path: `/api/v1/claims/${encodeURIComponent(claimId)}` });
    return res.data;
  }
}
