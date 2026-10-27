/**
 * Terms Module: read and accept the Delegance Terms of Service with a key.
 *
 * A v1 bind can require acceptance of the CURRENT version on file for the
 * key's user. After the Terms change, `accept` records the new version on
 * that user's profile (the server stamps the time).
 */

import { HttpClient } from '../utils/http';
import type { TermsInfo } from './signup';

export interface TermsAcceptance {
  version: string;
  acceptedAt: string;
}

export class TermsModule {
  constructor(private http: HttpClient) {}

  /** The current version, the Terms / Privacy / SLA links, and the summaries to show. */
  async get(): Promise<TermsInfo> {
    const res = await this.http.request<{ data: TermsInfo }>({ method: 'GET', path: '/api/v1/legal/terms' });
    return res.data;
  }

  /** Accept `version` (it must be the current one; read it with `get`). */
  async accept(version: string): Promise<TermsAcceptance> {
    const res = await this.http.request<{ data: TermsAcceptance }>({
      method: 'POST',
      path: '/api/v1/legal/terms/accept',
      body: { termsAccepted: true, termsVersion: version },
    });
    return res.data;
  }
}
