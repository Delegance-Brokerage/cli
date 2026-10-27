/**
 * Onboarding Module
 *
 * Provides a status checklist for developer onboarding: account setup,
 * company profile completeness, billing plan, and quote readiness.
 */

import { HttpClient } from '../utils/http';
import { ValidationError } from '../types';

// ============================================
// Types
// ============================================

/** The next recommended action for the developer to complete onboarding. */
export interface OnboardingNextStep {
  /** Short identifier for the action, e.g. 'complete_company_profile'. */
  action: string;
  /** Optional list of fields that are missing or incomplete. */
  fields?: string[];
  /** Optional URL the developer can visit to resolve the step. */
  url?: string;
}

/**
 * Onboarding status checklist returned by `onboarding.status()`.
 */
export interface OnboardingStatus {
  /**
   * Account-level setup (API key present, company exists).
   * Always 'complete' when this endpoint returns successfully.
   */
  account: 'complete';

  /**
   * Minimum company profile (name + industry present).
   * 'minimum' = name and industry filled in.
   * 'complete' = all core fields populated (contact email, address, etc.).
   */
  company: 'minimum' | 'complete';

  /**
   * Full company profile completeness (all non-critical optional fields).
   * 'incomplete' = some optional fields are missing.
   * 'complete' = every optional field is populated.
   */
  companyFull: 'incomplete' | 'complete';

  /**
   * Current billing plan status.
   * 'sandbox' = free developer sandbox.
   * 'active' = paid plan in good standing.
   * 'past_due' = payment failed, degraded access.
   * 'cancelled' = subscription cancelled.
   */
  billing: 'sandbox' | 'active' | 'past_due' | 'cancelled';

  /**
   * Whether the company has enough information to submit a quote request.
   * Requires at minimum: company name, industry, contact email.
   */
  quoteReady: boolean;

  /**
   * Whether the API key belongs to a sandbox (developer-trial) company.
   */
  sandbox: boolean;

  /**
   * The next recommended action, or null if onboarding is fully complete.
   */
  nextStep: OnboardingNextStep | null;
}

// ============================================
// WS1 state machine types (frozen contract: sdk/contract/openapi.yaml)
// ============================================

/** The five onboarding states of the frozen WS1 contract. */
export type OnboardingState =
  | 'created'
  | 'awaiting_verification'
  | 'documents_pending'
  | 'processing'
  | 'ready';

/** Data payload of `GET /api/v1/onboarding/state`. */
export interface OnboardingStateData {
  state: OnboardingState;
  verified: boolean;
  capabilities: string[];
  verification: { challengeIssued: boolean; sentTo: string | null };
  documents: { total: number; processing: number; processed: number };
}

// ============================================
// Internal response shapes
// ============================================

interface OnboardingStatusResponse {
  success: boolean;
  data: OnboardingStatus;
  traceId: string;
}

interface Envelope<T> {
  success: boolean;
  data: T;
  traceId: string;
}

// ============================================
// Module
// ============================================

export class OnboardingModule {
  constructor(private http: HttpClient) {}

  /**
   * Retrieve the onboarding status checklist for the authenticated company.
   *
   * Use this to determine what setup steps remain before going live.
   *
   * @example
   * ```typescript
   * const status = await client.onboarding.status();
   *
   * if (!status.quoteReady) {
   *   console.log('Next step:', status.nextStep?.action);
   * }
   *
   * if (status.sandbox) {
   *   console.log('Running in sandbox mode — upgrade to submit live quotes.');
   * }
   * ```
   */
  async status(): Promise<OnboardingStatus> {
    const response = await this.http.request<OnboardingStatusResponse>({
      method: 'GET',
      path: '/api/v1/onboarding/status',
    });
    return response.data;
  }

  /** Poll the canonical onboarding state machine. Callable pre-verification. */
  async state(): Promise<OnboardingStateData> {
    const response = await this.http.request<Envelope<OnboardingStateData>>({
      method: 'GET',
      path: '/api/v1/onboarding/state',
    });
    return response.data;
  }

  /**
   * Issue (or re-issue) the human verification challenge. Delegance emails a
   * confirmation link to the company contact email. Hand that link to a human;
   * the agent cannot self-verify.
   */
  async requestVerification(): Promise<{ state: OnboardingState; sentTo: string }> {
    const response = await this.http.request<
      Envelope<{ state: OnboardingState; method: string; sentTo: string }>
    >({
      method: 'POST',
      path: '/api/v1/onboarding/verification',
    });
    return { state: response.data.state, sentTo: response.data.sentTo };
  }

  /** Poll state() until `target` is reached or `timeoutMs` elapses. */
  async waitForState(
    target: OnboardingState,
    options: { intervalMs?: number; timeoutMs?: number } = {}
  ): Promise<OnboardingStateData> {
    const intervalMs = options.intervalMs ?? 5000;
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    // NaN would make the deadline check always false and poll forever.
    if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new ValidationError('intervalMs and timeoutMs must be positive numbers');
    }
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await this.state();
      if (current.state === target) return current;
      if (Date.now() + intervalMs > deadline) {
        throw new Error(
          `waitForState('${target}') timed out after ${timeoutMs}ms (last state: ${current.state})`
        );
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}
