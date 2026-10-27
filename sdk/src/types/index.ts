/**
 * Delegance SDK Types
 */

import { z } from 'zod';

// ============================================
// Configuration Types
// ============================================

export interface DeleganceClientConfig {
  /** API key for authentication (format: dlg_xxx_sk_xxx) */
  apiKey: string;
  
  /** Base URL for the Delegance API (default: https://portal.delegancebrokerage.com) */
  baseUrl?: string;
  
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  
  /**
   * Number of retry attempts for failed requests (default: 3). Only reads
   * (GET) and writes marked `idempotent` that carry an Idempotency-Key are
   * retried; every other write is sent once.
   */
  retries?: number;

  /**
   * Upper bound in milliseconds on the time spent waiting between retries of
   * one request (default: 60000). A Retry-After longer than what is left ends
   * the retries and surfaces the error.
   */
  retryDeadlineMs?: number;
  
  /** Custom headers to include in all requests */
  headers?: Record<string, string>;
}

// ============================================
// API Response Types
// ============================================

export interface APIResponse<T = unknown> {
  success: boolean;
  traceId: string;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends APIResponse<T[]> {
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// ============================================
// Company Types
// ============================================

// '0' = no W-2 employees, just the owners. Mirrors lib/supabase/schema-guards.ts.
export const CompanySizeSchema = z.enum(['0', '1', '2-10', '11-25', '26-50', '51-100', '100-499', '500+']);
export type CompanySize = z.infer<typeof CompanySizeSchema>;

export const CreateCompanySchema = z.object({
  name: z.string().min(1).max(255),
  legalName: z.string().max(255).optional(),
  dba: z.string().max(255).optional(),
  industry: z.string().min(1).max(100),
  companySize: CompanySizeSchema,
  yearEstablished: z.string().regex(/^\d{4}$/).optional(),
  website: z.string().url().optional(),
  fein: z.string().regex(/^\d{2}-\d{7}$/).optional(),
  companyStructure: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  contactEmail: z.string().email(),
  contactPhone: z.string().max(20).optional(),
  address: z.object({
    street: z.string().max(255),
    suite: z.string().max(50).optional(),
    city: z.string().max(100),
    state: z.string().length(2),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/)
  }).optional(),
  externalId: z.string().max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CreateCompanyInput = z.infer<typeof CreateCompanySchema>;

export interface Company {
  id: string;
  name: string;
  legalName?: string;
  industry: string;
  companySize: CompanySize;
  contactEmail: string;
  website?: string;
  createdAt: string;
}

// ============================================
// Document Types
// ============================================

export const DocumentTypeSchema = z.enum([
  'policy',
  'loss_run',
  'financial_statement',
  'sov',
  'application',
  'certificate',
  'endorsement',
  'bor',
  'other'
]);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'processed',
  'error',
  'failed'
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export interface UploadDocumentInput {
  /**
   * Optional. An API key belongs to one company, and the document goes there.
   * Naming any other company answers 403 with `code: 'company_mismatch'`.
   */
  companyId?: string;
  
  /** File to upload (Buffer, Blob, or base64 string) */
  file: Buffer | Blob | string;
  
  /** File name */
  fileName: string;
  
  /** Document type for classification hint */
  documentType?: DocumentType;
  
  /** External ID for idempotency/reference */
  externalId?: string;
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface Document {
  id: string;
  companyId?: string;
  fileName: string;
  documentType?: DocumentType;
  status: DocumentStatus;
  fileSize: number;
  createdAt: string;
  updatedAt?: string;
  externalId?: string;
}

export interface DocumentWithExtraction extends Document {
  extraction?: {
    hasText: boolean;
    textLength: number;
    policies: ExtractedPolicy[];
  };
  processing?: {
    message: string;
    estimatedTimeSeconds: number;
  };
  error?: {
    message: string;
    code?: string;
  };
}

export interface ExtractedPolicy {
  id: string;
  policyType: string;
  policyNumber?: string;
  carrierName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  premium?: number;
  coverageLimit?: number;
}

// ============================================
// API Key Types
// ============================================

export interface APIKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  isActive: boolean;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export interface CreateAPIKeyInput {
  name: string;
  scopes?: ('read' | 'write' | 'admin' | 'appetite:read' | 'mcp:read' | 'mcp:orin' | 'claims:write')[];
  /** 1 to 365, or 'never' for a read-only key. Omitted: 90 days. */
  expiresInDays?: number | 'never';
}

export interface CreatedAPIKey extends APIKey {
  /** The full API key - only shown once at creation time */
  key: string;
}

// ============================================
// Error Types
// ============================================

/**
 * Stable `code` values the v1 API sends on an error answer (API hardening
 * H2b). Mirrors the `V1ErrorCode` enum in sdk/contract/openapi.yaml; a unit
 * test fails on drift.
 */
export const V1_ERROR_CODES = [
  'invalid_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'idempotency_in_progress',
  'idempotency_mismatch',
  'payload_too_large',
  'client_upgrade_required',
  'rate_limited',
  'not_available',
  'upstream_unavailable',
  'upstream_timeout',
  'internal',
] as const;

export type V1ErrorCode = (typeof V1_ERROR_CODES)[number];

export class DeleganceError extends Error {
  /** Machine-readable `reason` from the error body, when the server sent one. */
  public reason?: string;

  /**
   * Machine-readable `code` from the error body, when the server sent one.
   * v1 API-key routes send a value from V1_ERROR_CODES (`rate_limited`,
   * `idempotency_in_progress`, ...); a few older routes keep their own
   * (e.g. `company_mismatch` on a 403 for a company the key does not own).
   */
  public code?: V1ErrorCode | (string & {});

  /**
   * The server's `retryable` flag: true when sending the same request again
   * later may succeed. Undefined against a server that predates the field.
   * It is advice about the request, not permission to resend a write: the
   * SDK still resends a write only when the route is marked idempotent.
   */
  public retryable?: boolean;

  /** The parsed error body, for fields a caller needs (portalUrl, hint). */
  public body?: Record<string, unknown>;

  constructor(
    message: string,
    public statusCode: number,
    public traceId?: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'DeleganceError';
  }
}

export class AuthenticationError extends DeleganceError {
  constructor(message: string, traceId?: string) {
    super(message, 401, traceId);
    this.name = 'AuthenticationError';
  }
}

export class ValidationError extends DeleganceError {
  constructor(message: string, details?: unknown, traceId?: string) {
    super(message, 400, traceId, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends DeleganceError {
  constructor(message: string, traceId?: string) {
    super(message, 404, traceId);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends DeleganceError {
  constructor(message: string, public retryAfter?: number, traceId?: string) {
    super(message, 429, traceId);
    this.name = 'RateLimitError';
  }
}

/**
 * A write got no answer: it timed out or the network failed after the request
 * left. The server may or may not have acted on it. The SDK does not resend
 * such a write on its own, because a second send could create a second claim,
 * certificate or bind request. Check whether it went through (list or get the
 * resource) before you send it again.
 *
 * `statusCode` is 0 because no HTTP response arrived.
 */
export class OutcomeUnknownError extends DeleganceError {
  public readonly outcome = 'unknown' as const;

  constructor(
    message: string,
    public readonly method: string,
    public readonly path: string,
    public readonly timedOut: boolean,
    public readonly cause?: unknown
  ) {
    super(message, 0);
    this.name = 'OutcomeUnknownError';
  }
}

export class ForbiddenError extends DeleganceError {
  constructor(message: string, traceId?: string) {
    super(message, 403, traceId);
    this.name = 'ForbiddenError';
  }
}

/**
 * The server recognised the request but the capability is not live yet
 * (HTTP 501). Permanent for the current deployment, so it is never retried.
 */
export class NotImplementedError extends DeleganceError {
  constructor(message: string, traceId?: string) {
    super(message, 501, traceId);
    this.name = 'NotImplementedError';
  }
}
