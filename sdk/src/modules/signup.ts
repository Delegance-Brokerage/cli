/**
 * Signup Module: commercial insurance from a terminal, step one.
 *
 * Signup is a device-code exchange. No API key exists yet, so this module
 * runs unauthenticated except for `enroll` and `requestVerification`, which
 * use the one-time bootstrap key the signup returns.
 *
 *   1. createAccount     unverified company + bootstrap key
 *   2. enroll            register SHA-256(deviceSecret) against that key
 *   3. requestVerification  emails the confirm link to the contact email
 *   4. exchange          poll with the plaintext deviceSecret; after the human
 *                        clicks the link it returns a user-bound API key
 *
 * The device secret never leaves the terminal except to `exchange`, and the
 * bootstrap key is revoked server-side once the email is confirmed.
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import { HttpClient } from '../utils/http';
import { pollUntilReady } from '../utils/poll';

export interface CreateAccountInput {
  name: string;
  contactEmail: string;
  industry: string;
  /** Employee band: '0', '1', '2-10', '11-25', '26-50', '51-100', '100-499', '500+'. */
  companySize: string;
  /** One or two sentences on what the business does; feeds carrier class matching. */
  description?: string;
  website?: string;
  contactPhone?: string;
  address?: { street: string; suite?: string; city: string; state: string; zip: string };
}

export interface CreateAccountResult {
  companyId: string;
  bootstrapKey: string;
  /** e.g. 'address_not_saved': the account exists but the server could not store part of it. */
  warnings?: string[];
}

/** GET /api/v1/legal/terms: what the user is asked to accept. */
export interface TermsInfo {
  version: string;
  termsUrl: string;
  privacyUrl: string;
  slaUrl: string;
  /** One-line summaries to show beside the links (the self-directed placement disclosure first). */
  summaries: string[];
  brokerReview: { email: string; command: string };
}

export interface EnrollResult {
  enrollmentId: string;
  expiresAt: string;
}

export type ExchangeResult =
  | { status: 'pending' }
  | { status: 'ready'; apiKey: string; keyPrefix: string; companyId: string };

/** 32 random bytes as hex, and its SHA-256. */
export function newDeviceSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('hex');
  return { secret, hash: createHash('sha256').update(secret).digest('hex') };
}

export class SignupModule {
  constructor(private makeHttp: (apiKey: string) => HttpClient) {}

  /**
   * Creates the unverified company. Sends an Idempotency-Key and goes out
   * once; after a timeout, call again with the same `idempotencyKey`.
   */
  async createAccount(input: CreateAccountInput, opts: { idempotencyKey?: string } = {}): Promise<CreateAccountResult> {
    const res = await this.makeHttp('').request<{ company: { id: string }; bootstrapKey: string | null; warnings?: string[] }>({
      method: 'POST',
      path: '/api/v1/companies',
      body: input,
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
    if (!res.bootstrapKey) {
      throw new Error('The signup was already created by an earlier attempt; its key is shown only once. Start again with a new signup.');
    }
    return {
      companyId: res.company.id,
      bootstrapKey: res.bootstrapKey,
      ...(res.warnings?.length ? { warnings: res.warnings } : {}),
    };
  }

  /** The current Terms of Service version and links. Public: no key. */
  async getTerms(): Promise<TermsInfo> {
    const res = await this.makeHttp('').request<{ data: TermsInfo }>({ method: 'GET', path: '/api/v1/legal/terms' });
    return res.data;
  }

  /**
   * Register this terminal. The server refuses without `termsAccepted: true`
   * and the CURRENT `termsVersion` (from `getTerms`).
   */
  async enroll(
    bootstrapKey: string,
    input: { deviceSecretHash: string; firstName: string; lastName: string; termsAccepted: true; termsVersion: string },
  ): Promise<EnrollResult> {
    const res = await this.makeHttp(bootstrapKey).request<{ data: EnrollResult }>({
      method: 'POST',
      path: '/api/v1/onboarding/cli-enroll',
      body: input,
    });
    return res.data;
  }

  async requestVerification(bootstrapKey: string): Promise<{ sentTo?: string }> {
    const res = await this.makeHttp(bootstrapKey).request<{ data?: { sentTo?: string } }>({
      method: 'POST',
      path: '/api/v1/onboarding/verification',
      body: {},
    });
    return { sentTo: res.data?.sentTo };
  }

  /**
   * One poll. `pending` until the email link is clicked. Throws with
   * `reason` = already_collected | account_exists (409) or expired (410).
   */
  async exchange(enrollmentId: string, deviceSecret: string): Promise<ExchangeResult> {
    const res = await this.makeHttp('').request<{ data: { status?: string; apiKey?: string; keyPrefix?: string; companyId?: string } }>({
      method: 'POST',
      path: '/api/v1/onboarding/cli-exchange',
      body: { enrollmentId, deviceSecret },
    });
    if (res.data?.apiKey && res.data.keyPrefix && res.data.companyId) {
      return { status: 'ready', apiKey: res.data.apiKey, keyPrefix: res.data.keyPrefix, companyId: res.data.companyId };
    }
    if (res.data?.status === 'pending') return { status: 'pending' };
    // Anything else is not "keep waiting": surface it.
    throw new Error('Unexpected response from the key exchange. Run "delegance verify" to retry.');
  }

  /**
   * Polls `exchange` until the key is ready or `timeoutMs` passes. A 429 waits
   * the server's Retry-After and keeps polling.
   */
  async waitForKey(
    enrollmentId: string,
    deviceSecret: string,
    opts: { timeoutMs?: number; intervalMs?: number; onPoll?: () => void } = {},
  ): Promise<ExchangeResult> {
    return pollUntilReady(() => this.exchange(enrollmentId, deviceSecret), opts);
  }
}
