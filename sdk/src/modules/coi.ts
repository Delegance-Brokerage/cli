/**
 * COI (Certificate of Insurance) Module
 * 
 * Handles COI generation and management.
 */

import { HttpClient } from '../utils/http';

export interface CertificateHolder {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  email?: string;
}

export interface GenerateCOIRequest {
  /** Policy IDs to include in the COI */
  policyIds: string[];
  
  /** Certificate holder information */
  certificateHolder: CertificateHolder;
  
  /** Type of certificate */
  certificateType?: 'additional_insured' | 'certificate_holder';
  
  /** Description/project name */
  description?: string;
  
  /** Special provisions or endorsements */
  specialProvisions?: string[];
}

export interface GenerateCOIResponse {
  success: boolean;
  coiId: string;
  downloadUrl: string;
  expiresAt: string;
  policiesIncluded: Array<{
    id: string;
    carrier: string;
    policyType: string;
  }>;
  traceId: string;
}

export interface COI {
  id: string;
  certificateHolder: string;
  certificateType: string;
  policyIds: string[];
  s3Key?: string;
  createdAt: string;
}

export interface ListCOIsResponse {
  success: boolean;
  cois: COI[];
  count: number;
  traceId: string;
}

export class COIModule {
  constructor(private http: HttpClient) {}

  /**
   * Generate a Certificate of Insurance
   * 
   * @example
   * ```typescript
   * const { policies } = await client.policies.list({ status: 'active' });
   * 
   * const result = await client.coi.generate({
   *   policyIds: policies.map(p => p.id),
   *   certificateHolder: {
   *     name: 'ABC Property Management',
   *     address: '123 Main St',
   *     city: 'New York',
   *     state: 'NY',
   *     zip: '10001'
   *   },
   *   certificateType: 'additional_insured'
   * });
   * 
   * console.log('Download URL:', result.downloadUrl);
   * ```
   */
  async generate(request: GenerateCOIRequest): Promise<GenerateCOIResponse> {
    return this.http.request<GenerateCOIResponse>({
      method: 'POST',
      path: '/api/v1/coi',
      body: request,
    });
  }

  /**
   * List generated COIs
   * 
   * @param limit - Maximum results (default: 50)
   */
  async list(limit: number = 50): Promise<ListCOIsResponse> {
    return this.http.request<ListCOIsResponse>({
      method: 'GET',
      path: `/api/v1/coi?limit=${limit}`,
    });
  }
}
