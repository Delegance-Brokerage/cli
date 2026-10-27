/**
 * Auth Module: sign a terminal in with the browser, and inspect or refresh
 * the key it holds.
 *
 * Browser login is a device authorization (the same device-secret exchange
 * as signup):
 *
 *   1. start      send SHA-256(deviceSecret); get a short code and a portal URL
 *   2. (human)    a signed-in portal user opens the URL and approves the code
 *   3. waitForKey poll with the plaintext deviceSecret until the key is ready
 *
 * The device secret never leaves the terminal except to the token poll, and
 * the key can be collected once.
 */

import { HttpClient } from '../utils/http';
import { pollUntilReady, type PollOptions } from '../utils/poll';

export interface DeviceLoginStart {
  loginId: string;
  /** Shown as XXXX-XXXX; the portal page asks the human to match it. */
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: string;
  /** Seconds between polls. */
  interval: number;
}

export type DeviceLoginPoll =
  | { status: 'pending' }
  | { status: 'ready'; apiKey: string; keyPrefix: string; companyId: string; scopes: string[]; expiresAt: string | null };

export interface ApiKeyInfo {
  keyPrefix: string;
  origin: string | null;
  scopes: string[];
  companyId: string;
  userBound: boolean;
  /** ISO time, or null for a key that never expires. */
  expiresAt: string | null;
  /** True for CLI keys, which `refresh()` can extend. */
  refreshable: boolean;
  createdAt: string | null;
}

export class DeviceLoginModule {
  constructor(private makeHttp: (apiKey: string) => HttpClient) {}

  async start(input: { deviceSecretHash: string; deviceName: string }): Promise<DeviceLoginStart> {
    const res = await this.makeHttp('').request<{ data: DeviceLoginStart }>({
      method: 'POST',
      path: '/api/v1/auth/device',
      body: input,
    });
    return res.data;
  }

  /**
   * One poll. `pending` until the portal user approves. Throws with `reason`
   * = access_denied (403), already_collected (409), or expired (410).
   */
  async poll(loginId: string, deviceSecret: string): Promise<DeviceLoginPoll> {
    const res = await this.makeHttp('').request<{
      data: { status?: string; apiKey?: string; keyPrefix?: string; companyId?: string; scopes?: string[]; expiresAt?: string | null };
    }>({
      method: 'POST',
      path: '/api/v1/auth/device/token',
      body: { loginId, deviceSecret },
    });
    const d = res.data ?? {};
    if (d.apiKey && d.keyPrefix && d.companyId) {
      return { status: 'ready', apiKey: d.apiKey, keyPrefix: d.keyPrefix, companyId: d.companyId, scopes: d.scopes ?? [], expiresAt: d.expiresAt ?? null };
    }
    if (d.status === 'pending') return { status: 'pending' };
    throw new Error('Unexpected response from the login poll. Run "delegance auth login" again.');
  }

  /** Polls until the key is ready or `timeoutMs` passes (then returns `pending`). */
  async waitForKey(loginId: string, deviceSecret: string, opts: PollOptions = {}): Promise<DeviceLoginPoll> {
    return pollUntilReady(() => this.poll(loginId, deviceSecret), opts);
  }
}

export class AuthModule {
  constructor(private http: HttpClient) {}

  /** The calling key: prefix, origin, scopes, company, and expiry. */
  async keyInfo(): Promise<ApiKeyInfo> {
    const res = await this.http.request<{ data: ApiKeyInfo }>({ method: 'GET', path: '/api/v1/auth/key' });
    return res.data;
  }

  /** Extend a CLI key to 90 days from now. Throws `not_refreshable` (400) for portal keys. */
  async refresh(): Promise<{ expiresAt: string }> {
    const res = await this.http.request<{ data: { expiresAt: string } }>({ method: 'POST', path: '/api/v1/auth/refresh', body: {} });
    return res.data;
  }
}
