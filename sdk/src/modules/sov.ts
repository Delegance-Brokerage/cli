/**
 * SOV (Schedule of Values) Module
 * 
 * Handles SOV upload and management for commercial property insurance.
 */

import { HttpClient } from '../utils/http';
import { DeleganceError, NotFoundError, AuthenticationError, RateLimitError, ValidationError } from '../types';

export interface UploadSOVRequest {
  /** File buffer or Blob */
  file: Buffer | Blob | ArrayBuffer;
  
  /** Original file name */
  fileName: string;
  
  /** Line of business (default: property) */
  lineOfBusiness?: string;
  
  /** Policy effective date */
  effectiveDate?: string;
  
  /** Policy expiration date */
  expirationDate?: string;
}

export interface UploadSOVResponse {
  success: boolean;
  sovId: string;
  s3Key: string;
  status: string;
  message: string;
  traceId: string;
}

export interface SOV {
  id: string;
  fileName: string;
  status: 'uploaded' | 'parsing' | 'parsed' | 'validated' | 'submitted' | 'error';
  lineOfBusiness: string;
  effectiveDate?: string;
  expirationDate?: string;
  totalLocations?: number;
  totalTIV?: number;
  totalBuildingValue?: number;
  totalContentsValue?: number;
  totalBIValue?: number;
  currency: string;
  validationErrors?: string[];
  parsingErrors?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface SOVLocation {
  id: string;
  locationNumber: number;
  locationName?: string;
  address: {
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    county?: string;
    country?: string;
  };
  values: {
    building?: number;
    contents?: number;
    businessIncome?: number;
    total?: number;
  };
  construction: {
    type?: string;
    yearBuilt?: number;
    stories?: number;
    squareFeet?: number;
    roofType?: string;
  };
  occupancy?: string;
  protectionClass?: string;
  sprinklered?: boolean;
  validationIssues?: string[];
}

export interface GetSOVResponse {
  success: boolean;
  sov: SOV;
  processing?: {
    message: string;
    status: string;
  };
  locations?: {
    items: SOVLocation[];
    pagination: {
      total: number;
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };
  traceId: string;
}

export interface ListSOVsResponse {
  success: boolean;
  sovs: SOV[];
  count: number;
  traceId: string;
}

export interface ListSOVsOptions {
  /** Filter by status */
  status?: 'uploaded' | 'parsing' | 'parsed' | 'validated' | 'error';
  
  /** Maximum results (default: 50) */
  limit?: number;
}

export class SOVModule {
  constructor(private http: HttpClient) {}

  /**
   * Upload a Schedule of Values file
   * 
   * @example
   * ```typescript
   * import fs from 'fs';
   * 
   * const result = await client.sov.upload({
   *   file: fs.readFileSync('./property-schedule.xlsx'),
   *   fileName: 'property-schedule.xlsx',
   *   lineOfBusiness: 'property',
   *   effectiveDate: '2024-01-01'
   * });
   * 
   * console.log('SOV ID:', result.sovId);
   * ```
   */
  async upload(request: UploadSOVRequest): Promise<UploadSOVResponse> {
    // Normalize file: convert ArrayBuffer to Blob, pass Buffer/Blob directly
    let fileData: Buffer | Blob;
    if (request.file instanceof ArrayBuffer) {
      fileData = new Blob([new Uint8Array(request.file)]);
    } else {
      fileData = request.file as Buffer | Blob;
    }

    // Build additional fields
    const additionalFields: Record<string, string> = {};
    if (request.lineOfBusiness) additionalFields.lineOfBusiness = request.lineOfBusiness;
    if (request.effectiveDate) additionalFields.effectiveDate = request.effectiveDate;
    if (request.expirationDate) additionalFields.expirationDate = request.expirationDate;

    return this.http.uploadFile<UploadSOVResponse>(
      '/api/v1/sov',
      fileData,
      request.fileName,
      additionalFields
    );
  }

  /**
   * List SOVs for the company
   */
  async list(options: ListSOVsOptions = {}): Promise<ListSOVsResponse> {
    const params = new URLSearchParams();
    if (options.status) params.set('status', options.status);
    if (options.limit) params.set('limit', String(options.limit));
    
    const query = params.toString();
    const path = query ? `/api/v1/sov?${query}` : '/api/v1/sov';
    
    return this.http.request<ListSOVsResponse>({
      method: 'GET',
      path,
    });
  }

  /**
   * Get a single SOV by ID with full details and locations
   * 
   * @example
   * ```typescript
   * const { sov, locations } = await client.sov.get('sov-uuid');
   * console.log(`${sov.totalLocations} locations, TIV: $${sov.totalTIV}`);
   * 
   * // Access individual locations
   * for (const loc of locations.items) {
   *   console.log(`${loc.address.city}, ${loc.address.state}: $${loc.values.total}`);
   * }
   * ```
   */
  async get(
    sovId: string,
    options: { includeLocations?: boolean; locationLimit?: number; locationOffset?: number } = {}
  ): Promise<GetSOVResponse> {
    const params = new URLSearchParams();
    if (options.includeLocations !== undefined) {
      params.set('includeLocations', String(options.includeLocations));
    }
    if (options.locationLimit) params.set('locationLimit', String(options.locationLimit));
    if (options.locationOffset) params.set('locationOffset', String(options.locationOffset));
    
    const query = params.toString();
    const path = query ? `/api/v1/sov/${sovId}?${query}` : `/api/v1/sov/${sovId}`;
    
    return this.http.request<GetSOVResponse>({
      method: 'GET',
      path,
    });
  }

  /**
   * Wait for SOV parsing to complete
   */
  async waitForParsing(
    sovId: string,
    options: { timeoutMs?: number; pollIntervalMs?: number } = {}
  ): Promise<SOV> {
    const { timeoutMs = 120000, pollIntervalMs = 3000 } = options; // 2 min default
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      try {
        const { sov } = await this.get(sovId, { includeLocations: false });
        
        if (['parsed', 'validated', 'submitted', 'error'].includes(sov.status)) {
          return sov;
        }
      } catch (error) {
        if (
          error instanceof NotFoundError ||
          error instanceof AuthenticationError ||
          error instanceof RateLimitError ||
          error instanceof ValidationError
        ) {
          throw error;
        }
        // Transient errors — continue polling
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new DeleganceError(`SOV ${sovId} did not complete parsing within ${timeoutMs}ms`, 408);
  }
}
