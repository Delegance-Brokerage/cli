/**
 * Usage Module
 *
 * Provides access to API usage data: billing summaries, daily breakdowns,
 * and current rate-limit status.
 */

import { HttpClient } from '../utils/http';
import { ValidationError } from '../types';

// ============================================
// Types
// ============================================

export interface MeterUsage {
  used: number;
  included: number;
  overage: number;
  overageCostCents: number;
}

export interface UsageSummary {
  /** Billing period, e.g. '2026-04' */
  period: string;
  /** Plan name, e.g. 'growth' */
  plan: string;
  /** Whether the period is still being estimated, has been invoiced, or is a shadow run */
  status: 'estimated' | 'invoiced' | 'shadow';
  /** Per-meter usage breakdown keyed by meter name */
  meters: Record<string, MeterUsage>;
  /** Total overage charges in cents across all meters */
  totalOverageCents: number;
  /** ISO-8601 timestamp of when this snapshot was computed */
  asOf: string;
}

export interface DailyUsage {
  date: string;
  meter: string;
  quantity: number;
}

export interface RateLimitStatus {
  requestsPerMinute: number;
  remaining: number;
  /** ISO-8601 timestamp at which the rate-limit window resets */
  resetsAt: string;
}

export interface DailyUsageOptions {
  /** Start date (inclusive), e.g. '2026-04-01' */
  from: string;
  /** End date (inclusive), e.g. '2026-04-30' */
  to: string;
  /** Filter to a single meter name */
  meter?: string;
  /** Aggregate by 'day' (default server behaviour) or 'meter' */
  groupBy?: 'day' | 'meter';
}

// ============================================
// Internal response shapes
// ============================================

interface UsageSummaryResponse {
  success: boolean;
  data: UsageSummary;
  traceId: string;
}

interface DailyUsageResponse {
  success: boolean;
  data: DailyUsage[];
  traceId: string;
}

interface RateLimitStatusResponse {
  success: boolean;
  data: RateLimitStatus;
  traceId: string;
}

// ============================================
// Module
// ============================================

export class UsageModule {
  constructor(private http: HttpClient) {}

  /**
   * Get a billing-period summary across all meters.
   *
   * @example
   * ```typescript
   * const summary = await client.usage.summary();
   * console.log(`Plan: ${summary.plan}, overage: $${summary.totalOverageCents / 100}`);
   * ```
   */
  async summary(): Promise<UsageSummary> {
    const response = await this.http.request<UsageSummaryResponse>({
      method: 'GET',
      path: '/api/v1/usage/summary',
    });
    return response.data;
  }

  /**
   * Get daily usage data for a date range.
   *
   * @example
   * ```typescript
   * const { data } = await client.usage.daily({
   *   from: '2026-04-01',
   *   to: '2026-04-30',
   *   meter: 'api_requests',
   * });
   * const total = data.reduce((sum, row) => sum + row.quantity, 0);
   * ```
   */
  async daily(options: DailyUsageOptions): Promise<{ data: DailyUsage[] }> {
    if (!options.from) {
      throw new ValidationError('daily() requires a non-empty "from" date');
    }
    if (!options.to) {
      throw new ValidationError('daily() requires a non-empty "to" date');
    }

    const params = new URLSearchParams();
    params.set('from', options.from);
    params.set('to', options.to);
    if (options.meter !== undefined) {
      params.set('meter', options.meter);
    }
    if (options.groupBy !== undefined) {
      params.set('groupBy', options.groupBy);
    }

    const response = await this.http.request<DailyUsageResponse>({
      method: 'GET',
      path: `/api/v1/usage/daily?${params.toString()}`,
    });

    return { data: response.data };
  }

  /**
   * Get the current rate-limit status for this API key.
   *
   * @example
   * ```typescript
   * const limits = await client.usage.rateLimits();
   * console.log(`${limits.remaining}/${limits.requestsPerMinute} requests remaining`);
   * ```
   */
  async rateLimits(): Promise<RateLimitStatus> {
    const response = await this.http.request<RateLimitStatusResponse>({
      method: 'GET',
      path: '/api/v1/usage/rate-limits',
    });
    return response.data;
  }
}
