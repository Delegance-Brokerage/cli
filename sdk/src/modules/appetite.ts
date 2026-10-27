/**
 * Appetite Module
 *
 * Carrier appetite matching: which carriers will write a given risk.
 *
 * Contract (POST /api/v1/appetite/match):
 * - warm cache hit -> 200 with the full validated result
 * - cold           -> 202 with a job id; poll GET /api/v1/appetite/match/:jobId
 *
 * Requires an API key carrying the `appetite:read` scope. That scope is not
 * implied by `read` or `write`. The endpoint answers 404 while the partner
 * API is disabled for the deployment.
 */

import { HttpClient } from '../utils/http';
import { DeleganceError, ValidationError } from '../types';

// ============================================
// Types
// ============================================

export interface AppetiteMatchInput {
  /** Two-letter US state code (required). */
  state: string;
  /** One of industry, businessDescription, naicsCode, or sicCode is required. */
  industry?: string;
  businessDescription?: string;
  naicsCode?: string;
  sicCode?: string;
  coverageTypes?: string[];
  carriers?: string[];
  marketSize?: 'Small Business' | 'Middle Market';
  productFilter?: 'off' | 'boost' | 'strict';
  annualRevenue?: number;
  annualPayroll?: number;
  propertyValue?: number;
  /** Callers may only raise the quality floor. */
  minFit?: 'possible' | 'strong';
  topK?: number;
  minScore?: number;
}

export interface AppetiteMatch {
  carrier: string;
  classDescription: string;
  industryCategory: string;
  product: string;
  appetite: 'Target' | 'Acceptable' | 'Limited' | 'Not Available';
  score: number;
  matchDetails: {
    codeMatchScore: number;
    semanticScore: number;
    stateMatch: boolean;
  };
  classCode: string;
  sicCode: string;
  naicsCode: string;
  limits: string;
  notes: string;
  marketSize: string;
}

export interface CarrierAppetiteResult {
  carrier: string;
  overallStatus: 'acceptable' | 'targeted' | 'limited' | 'declined' | 'unknown';
  confidence: number;
  bestMatch: AppetiteMatch;
  allMatches: AppetiteMatch[];
  productsAvailable: string[];
  warnings: string[];
}

export interface AppetiteMatchResult {
  matches: AppetiteMatch[];
  carrierResults: CarrierAppetiteResult[];
  suggestedCarriers: string[];
  warnings: string[];
  metadata: Record<string, unknown> & { validated?: boolean };
}

/** Result of `appetite.match()`: either a finished result or a queued job. */
export type AppetiteMatchStart =
  | ({ status: 'succeeded'; cached: true; jobId: null; traceId: string } & AppetiteMatchResult)
  | { status: 'queued'; jobId: string; statusUrl: string; estimatedSeconds: number; traceId: string };

export type AppetiteJobStatus =
  | { status: 'queued' | 'running'; jobId: string; estimatedSeconds: number; traceId: string }
  | ({ status: 'succeeded'; jobId: string; cached: false; traceId: string } & AppetiteMatchResult)
  | {
      status: 'failed';
      jobId: string;
      errorCode: string;
      retryable: boolean;
      retryAfterSeconds?: number;
      traceId: string;
    };

export interface WaitForMatchOptions {
  intervalMs?: number;
  timeoutMs?: number;
}

/** Drop the `success` envelope flag; the discriminant is `status`. */
function withoutEnvelope(response: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...response };
  delete copy.success;
  return copy;
}

// ============================================
// Module
// ============================================

export class AppetiteModule {
  constructor(private http: HttpClient) {}

  /**
   * Start an appetite match. Returns the result directly on a warm cache hit,
   * or a queued job to poll with `getMatch()`.
   *
   * @example
   * ```typescript
   * const start = await client.appetite.match({ state: 'CA', industry: 'restaurant' });
   * const result = start.status === 'succeeded'
   *   ? start
   *   : await client.appetite.waitForMatch(start.jobId);
   * ```
   */
  async match(input: AppetiteMatchInput): Promise<AppetiteMatchStart> {
    if (!input.state || input.state.trim().length !== 2) {
      throw new ValidationError('state must be a two-letter code');
    }
    if (!input.industry && !input.businessDescription && !input.naicsCode && !input.sicCode) {
      throw new ValidationError('One of industry, businessDescription, naicsCode, or sicCode is required');
    }
    const response = await this.http.request<Record<string, unknown>>({
      method: 'POST',
      path: '/api/v1/appetite/match',
      body: input,
    });

    // A queued job carries a non-null jobId and a statusUrl; a warm hit
    // returns the result inline with jobId null.
    if (typeof response.jobId === 'string' && typeof response.statusUrl === 'string') {
      return {
        status: 'queued',
        jobId: response.jobId,
        statusUrl: response.statusUrl,
        estimatedSeconds: (response.estimatedSeconds as number) ?? 20,
        traceId: response.traceId as string,
      };
    }
    return {
      ...(withoutEnvelope(response) as unknown as AppetiteMatchResult),
      status: 'succeeded',
      cached: true,
      jobId: null,
      traceId: response.traceId as string,
    };
  }

  /** Read a match job. Unknown, expired, and other-tenant ids all raise NotFoundError. */
  async getMatch(jobId: string): Promise<AppetiteJobStatus> {
    const response = await this.http.request<Record<string, unknown>>({
      method: 'GET',
      path: `/api/v1/appetite/match/${encodeURIComponent(jobId)}`,
    });
    return withoutEnvelope(response) as unknown as AppetiteJobStatus;
  }

  /**
   * Poll a job until it succeeds. Throws on a failed job (with the sanitized
   * errorCode) or on timeout.
   */
  async waitForMatch(
    jobId: string,
    options: WaitForMatchOptions = {}
  ): Promise<Extract<AppetiteJobStatus, { status: 'succeeded' }>> {
    const intervalMs = options.intervalMs ?? 3000;
    const timeoutMs = options.timeoutMs ?? 2 * 60 * 1000;
    // NaN would make the deadline check always false and poll forever.
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ValidationError('intervalMs and timeoutMs must be positive numbers');
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await this.getMatch(jobId);
      if (job.status === 'succeeded') return job;
      if (job.status === 'failed') {
        throw new DeleganceError(
          `Appetite match failed: ${job.errorCode}${job.retryable ? ' (retryable)' : ''}`,
          500,
          job.traceId
        );
      }
      if (Date.now() + intervalMs > deadline) {
        throw new DeleganceError(`Appetite match ${jobId} still ${job.status} after ${timeoutMs}ms`, 408);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
