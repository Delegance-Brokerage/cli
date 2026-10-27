/**
 * Leads Module
 *
 * Send a prospect business to Delegance (POST /api/v1/leads). Needs the
 * `write` scope. Idempotent on `externalId`, and a lead whose contact email
 * already belongs to a company returns that company instead of a duplicate.
 */

import { HttpClient } from '../utils/http';

export interface LeadAddress {
  street: string;
  suite?: string;
  city: string;
  /** Two-letter state code. */
  state: string;
  /** 5-digit or ZIP+4. */
  zip: string;
}

export interface CreateLeadInput {
  name: string;
  contactEmail: string;
  legalName?: string;
  industry?: string;
  contactPhone?: string;
  website?: string;
  companySize?: string;
  description?: string;
  sicCode?: string;
  naicsCode?: string;
  state?: string;
  address?: LeadAddress;
  externalId?: string;
  source?: string;
  sourceDetail?: Record<string, unknown>;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateLeadResult {
  success: boolean;
  companyId: string;
  message: string;
  traceId: string;
}

export class LeadsModule {
  constructor(private http: HttpClient) {}

  /**
   * Create a lead.
   *
   * @example
   * ```typescript
   * const { companyId } = await client.leads.create({
   *   name: 'Riverbend Bakery',
   *   contactEmail: 'owner@riverbend.example',
   *   state: 'TX',
   *   externalId: 'crm-4411',
   * });
   * ```
   */
  async create(input: CreateLeadInput): Promise<CreateLeadResult> {
    return this.http.request<CreateLeadResult>({
      method: 'POST',
      path: '/api/v1/leads',
      body: input,
    });
  }
}
