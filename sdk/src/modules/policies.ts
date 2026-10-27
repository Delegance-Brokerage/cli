/**
 * Policies Module
 * 
 * Handles insurance policy management.
 */

import { randomUUID } from 'crypto';
import { HttpClient } from '../utils/http';
import { NotFoundError } from '../types';

export interface Policy {
  id: string;
  name: string;
  carrier: string;
  policyNumber?: string;
  policyType?: string;
  premium?: number;
  deductible?: number;
  aggregateLimit?: number;
  occurrenceLimit?: number;
  effectiveDate?: string;
  expiryDate?: string;
  naicCode?: string;
  amBestRating?: string;
  sourceDocuments?: string[];
  coverageDetails?: Record<string, unknown>;
  exclusions?: string[];
  endorsements?: string[];
  additionalInsureds?: Array<{ name: string; relationship?: string }>;
  createdAt: string;
  updatedAt?: string;
  isActive: boolean;
  daysUntilExpiry?: number | null;
  status?: 'active' | 'expiring_soon' | 'expired';
}

export interface PolicyCoverage {
  id: string;
  coverageType: string;
  limit?: number;
  deductible?: number;
  description?: string;
}

export interface GetPolicyResponse {
  success: boolean;
  policy: Policy;
  coverages: PolicyCoverage[];
  traceId: string;
}

export interface ListPoliciesOptions {
  /** Filter by status: active, expired, all */
  status?: 'active' | 'expired' | 'all';
  
  /** Filter policies expiring within N days */
  expiringDays?: number;
  
  /** Filter by policy type */
  policyType?: string;
  
  /** Maximum results (default: 100) */
  limit?: number;
}

export interface ListPoliciesResponse {
  success: boolean;
  policies: Policy[];
  count: number;
  traceId: string;
}

export type CancellationReason = 'replaced' | 'business_closed' | 'sold' | 'not_needed' | 'other';

export interface CancellationRequestInput {
  /** YYYY-MM-DD; coverage ends at 12:01 AM that day. */
  requestedEffectiveDate: string;
  reason: CancellationReason;
  /** Required when reason is 'replaced'. */
  replacementPolicyId?: string;
}

export interface CancellationSignInput {
  signerName: string;
  signerTitle: string;
  /** The signer attests they may bind the named insured. Must be true. */
  attestAuthority: true;
  /** From the 202 that emailed the code. Omit both to (re)send a code. */
  stepUpId?: string;
  /** The 6-digit code from the email. */
  code?: string;
}

/** 202: a code went to the signer's email. 200: signed. */
export type CancellationSignResult =
  | { stepUpRequired: true; stepUpId: string; action: 'sign'; channel: 'email'; sentTo: string; expiresAt: string | null; requestId: string }
  | { status: 'signed'; requestId: string };

export interface CancellationStatus {
  id: string;
  policyId?: string;
  status: string;
  requestedEffectiveDate: string;
  reason: string;
  /** Claims-made continuity verdict: 'continuous', 'prior_acts_gap', 'unknown', ... */
  continuity: string;
  confirmedEffectiveDate?: string | null;
  confirmationNumber?: string | null;
  updatedAt?: string;
}

export class PoliciesModule {
  constructor(private http: HttpClient) {}

  /**
   * List policies for the company
   * 
   * @example
   * ```typescript
   * // List all active policies
   * const { policies } = await client.policies.list({ status: 'active' });
   * 
   * // List policies expiring in 30 days
   * const { policies: expiring } = await client.policies.list({ expiringDays: 30 });
   * ```
   */
  async list(options: ListPoliciesOptions = {}): Promise<ListPoliciesResponse> {
    const params = new URLSearchParams();
    if (options.status && options.status !== 'all') params.set('status', options.status);
    if (options.expiringDays) params.set('expiring', String(options.expiringDays));
    if (options.policyType) params.set('type', options.policyType);
    if (options.limit) params.set('limit', String(options.limit));
    
    const query = params.toString();
    const path = query ? `/api/v1/policies?${query}` : '/api/v1/policies';
    
    return this.http.request<ListPoliciesResponse>({
      method: 'GET',
      path,
    });
  }

  /**
   * Get policies expiring soon
   * 
   * @param days - Number of days to look ahead (default: 30)
   */
  async getExpiring(days: number = 30): Promise<ListPoliciesResponse> {
    return this.list({ expiringDays: days, status: 'active' });
  }

  /**
   * Get a single policy by ID with full details
   * 
   * @example
   * ```typescript
   * const { policy, coverages } = await client.policies.get('policy-uuid');
   * console.log(`${policy.carrier} - ${policy.policyType}`);
   * console.log(`Coverages: ${coverages.length}`);
   * ```
   */
  async get(policyId: string): Promise<{ policy: Policy; coverages: PolicyCoverage[] } | null> {
    try {
      const response = await this.http.request<GetPolicyResponse>({
        method: 'GET',
        path: `/api/v1/policies/${policyId}`,
      });
      
      return {
        policy: response.policy,
        coverages: response.coverages || []
      };
    } catch (error) {
      // Return null for 404s, throw other errors
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Ask to cancel a policy. The request waits for the insured's signature,
   * collected at `signatureUrl` by an owner or admin; a broker reviews the
   * claims-made continuity check before anything reaches the carrier.
   */
  async requestCancellation(
    policyId: string,
    input: CancellationRequestInput,
    opts: { idempotencyKey?: string } = {},
  ): Promise<{ request: CancellationStatus; signatureUrl: string; signEndpoint?: string }> {
    return this.http.request<{ request: CancellationStatus; signatureUrl: string; signEndpoint?: string }>({
      method: 'POST',
      path: `/api/v1/policies/${encodeURIComponent(policyId)}/cancellation`,
      body: input,
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
  }

  /**
   * Sign a cancellation request as an owner or admin. Signing needs a step-up
   * code: call once without `code` to email it (202 with `stepUpId`), then
   * again with `stepUpId` and `code`.
   */
  async signCancellation(
    requestId: string,
    input: CancellationSignInput,
    opts: { idempotencyKey?: string } = {},
  ): Promise<CancellationSignResult> {
    return this.http.request<CancellationSignResult>({
      method: 'POST',
      path: `/api/v1/policy-cancellations/${encodeURIComponent(requestId)}/sign`,
      body: input,
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
  }

  /** One cancellation request's status. */
  async getCancellation(requestId: string): Promise<CancellationStatus> {
    const res = await this.http.request<{ request: CancellationStatus }>({
      method: 'GET',
      path: `/api/v1/policy-cancellations/${encodeURIComponent(requestId)}`,
    });
    return res.request;
  }
}
