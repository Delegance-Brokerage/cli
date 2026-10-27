/**
 * Documents Module
 * 
 * Handles document upload, listing, and status operations.
 */

import { HttpClient } from '../utils/http';
import {
  Document,
  DocumentWithExtraction,
  DocumentType,
  DocumentStatus,
  UploadDocumentInput,
  ValidationError,
  DeleganceError,
  NotFoundError,
  AuthenticationError,
  RateLimitError
} from '../types';

interface UploadDocumentResponse {
  success: boolean;
  document: Document;
  message: string;
  traceId: string;
}

interface GetDocumentResponse {
  success: boolean;
  document: DocumentWithExtraction;
  extraction?: DocumentWithExtraction['extraction'];
  processing?: DocumentWithExtraction['processing'];
  error?: DocumentWithExtraction['error'];
  traceId: string;
}

interface ListDocumentsResponse {
  success: boolean;
  documents: Document[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
  traceId: string;
}

export interface ListDocumentsOptions {
  /** Filter by company ID */
  companyId?: string;

  /** Filter by document type */
  documentType?: DocumentType;

  /** Filter by status */
  status?: DocumentStatus;

  /** Filter by external ID */
  externalId?: string;
  
  /** Maximum number of documents to return (default: 50, max: 100) */
  limit?: number;
  
  /** Offset for pagination */
  offset?: number;
}

export interface WaitForExtractionOptions {
  /** Maximum time to wait in milliseconds (default: 120000 = 2 minutes) */
  timeoutMs?: number;
  
  /** Polling interval in milliseconds (default: 2000 = 2 seconds) */
  pollIntervalMs?: number;
  
  /** Callback for status updates */
  onStatusChange?: (status: DocumentStatus) => void;
}

export class DocumentsModule {
  constructor(private http: HttpClient) {}

  /**
   * Upload a document for processing
   * 
   * @example
   * ```typescript
   * import fs from 'fs';
   * 
   * const doc = await client.documents.upload({
   *   file: fs.readFileSync('./policy.pdf'),
   *   fileName: 'GL-2025.pdf',
   *   documentType: 'policy'
   * });
   * 
   * console.log(`Document ${doc.id} uploaded, status: ${doc.status}`);
   * ```
   */
  async upload(input: UploadDocumentInput): Promise<Document> {
    // Validate required fields. companyId is optional: an API key belongs to
    // one company and the server files the document there.
    if (!input.file) {
      throw new ValidationError('file is required');
    }
    if (!input.fileName) {
      throw new ValidationError('fileName is required');
    }

    // Convert file to Buffer if it's a base64 string
    let fileData: Buffer | Blob;
    if (typeof input.file === 'string') {
      fileData = Buffer.from(input.file, 'base64');
    } else {
      fileData = input.file;
    }

    // Build additional fields
    const additionalFields: Record<string, string> = {};
    if (input.companyId) {
      additionalFields.companyId = input.companyId;
    }

    if (input.documentType) {
      additionalFields.documentType = input.documentType;
    }
    if (input.externalId) {
      additionalFields.externalId = input.externalId;
    }
    if (input.metadata) {
      additionalFields.metadata = JSON.stringify(input.metadata);
    }

    const response = await this.http.uploadFile<UploadDocumentResponse>(
      '/api/v1/documents',
      fileData,
      input.fileName,
      additionalFields
    );

    return response.document;
  }

  /**
   * Upload multiple documents in batch
   * 
   * @example
   * ```typescript
   * const docs = await client.documents.uploadBatch([
   *   { file: buffer1, fileName: 'policy1.pdf' },
   *   { file: buffer2, fileName: 'policy2.pdf' }
   * ]);
   * ```
   */
  async uploadBatch(
    inputs: UploadDocumentInput[],
    options: { concurrency?: number } = {}
  ): Promise<{ documents: Document[]; errors: Array<{ input: UploadDocumentInput; error: Error }> }> {
    const concurrency = options.concurrency || 3;
    const documents: Document[] = [];
    const errors: Array<{ input: UploadDocumentInput; error: Error }> = [];

    // Process in batches
    for (let i = 0; i < inputs.length; i += concurrency) {
      const batch = inputs.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(input => this.upload(input))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          documents.push(result.value);
        } else {
          errors.push({ input: batch[j], error: result.reason });
        }
      }
    }

    return { documents, errors };
  }

  /**
   * Get document details and extraction status
   * 
   * @example
   * ```typescript
   * const doc = await client.documents.get('doc-uuid');
   * console.log(`Status: ${doc.status}`);
   * if (doc.extraction) {
   *   console.log(`Found ${doc.extraction.policies.length} policies`);
   * }
   * ```
   */
  async get(documentId: string): Promise<DocumentWithExtraction> {
    const response = await this.http.request<GetDocumentResponse>({
      method: 'GET',
      path: `/api/v1/documents/${documentId}`
    });

    return {
      ...response.document,
      extraction: response.extraction,
      processing: response.processing,
      error: response.error
    };
  }

  /**
   * List documents with optional filters
   * 
   * @example
   * ```typescript
   * // List all documents
   * const docs = await client.documents.list();
   * 
   * // Filter by type and status
   * const policies = await client.documents.list({
   *   documentType: 'policy',
   *   status: 'completed'
   * });
   * 
   * // Paginate
   * const page2 = await client.documents.list({ offset: 50, limit: 50 });
   * ```
   */
  async list(options: ListDocumentsOptions = {}): Promise<{
    documents: Document[];
    pagination: ListDocumentsResponse['pagination'];
  }> {
    const params = new URLSearchParams();

    if (options.companyId) params.set('companyId', options.companyId);
    if (options.documentType) params.set('documentType', options.documentType);
    if (options.status) params.set('status', options.status);
    if (options.externalId) params.set('externalId', options.externalId);
    if (options.limit) params.set('limit', String(options.limit));
    if (options.offset) params.set('offset', String(options.offset));

    const query = params.toString();
    const path = query ? `/api/v1/documents?${query}` : '/api/v1/documents';

    const response = await this.http.request<ListDocumentsResponse>({
      method: 'GET',
      path
    });

    return {
      documents: response.documents,
      pagination: response.pagination
    };
  }

  /**
   * Wait for document extraction to complete
   * 
   * @example
   * ```typescript
   * const doc = await client.documents.upload({ ... });
   * 
   * // Wait for processing to complete
   * const result = await client.documents.waitForExtraction(doc.id, {
   *   timeoutMs: 60000,
   *   onStatusChange: (status) => console.log(`Status: ${status}`)
   * });
   * 
   * if (result.extraction) {
   *   console.log('Extraction complete:', result.extraction.policies);
   * }
   * ```
   */
  async waitForExtraction(
    documentId: string,
    options: WaitForExtractionOptions = {}
  ): Promise<DocumentWithExtraction> {
    const {
      timeoutMs = 120000,
      pollIntervalMs = 2000,
      onStatusChange
    } = options;

    const startTime = Date.now();
    let lastStatus: DocumentStatus | null = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const doc = await this.get(documentId);

        // Notify status change
        if (onStatusChange && doc.status !== lastStatus) {
          onStatusChange(doc.status);
          lastStatus = doc.status;
        }

        // Check if processing is complete
        if (doc.status === 'completed' || doc.status === 'processed') {
          return doc;
        }

        // Check if processing failed
        if (doc.status === 'error' || doc.status === 'failed') {
          return doc;
        }
      } catch (error) {
        // Re-throw permanent errors immediately — don't wait for timeout
        if (
          error instanceof NotFoundError ||
          error instanceof AuthenticationError ||
          error instanceof RateLimitError ||
          error instanceof ValidationError
        ) {
          throw error;
        }
        // Transient errors (network, 5xx) — continue polling
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new DeleganceError(
      `Document ${documentId} extraction did not complete within ${timeoutMs}ms (last status: ${lastStatus || 'unknown'})`,
      408
    );
  }

  /**
   * Check if a document with the given external ID already exists
   * 
   * @example
   * ```typescript
   * const existing = await client.documents.findByExternalId('ams-doc-123');
   * if (existing) {
   *   console.log('Document already uploaded:', existing.id);
   * }
   * ```
   */
  async findByExternalId(externalId: string, companyId?: string): Promise<Document | null> {
    const params = new URLSearchParams();
    params.set('externalId', externalId);
    params.set('limit', '1');
    if (companyId) params.set('companyId', companyId);

    const response = await this.http.request<ListDocumentsResponse>({
      method: 'GET',
      path: `/api/v1/documents?${params.toString()}`
    });

    return response.documents[0] || null;
  }

  /**
   * Archive a document (soft delete)
   * 
   * This does NOT permanently delete the document - archived documents 
   * are excluded from list queries but remain for audit purposes.
   * 
   * @example
   * ```typescript
   * await client.documents.archive('doc-uuid');
   * console.log('Document archived');
   * ```
   */
  async archive(documentId: string): Promise<{ success: boolean; message: string }> {
    const response = await this.http.request<{ success: boolean; message: string; traceId: string }>({
      method: 'PATCH',
      path: `/api/v1/documents/${documentId}`,
      body: { action: 'archive' }
    });

    return { success: response.success, message: response.message };
  }

  /**
   * Unarchive a previously archived document
   * 
   * @example
   * ```typescript
   * await client.documents.unarchive('doc-uuid');
   * console.log('Document restored');
   * ```
   */
  async unarchive(documentId: string): Promise<{ success: boolean; message: string; status: string }> {
    const response = await this.http.request<{ success: boolean; message: string; status: string; traceId: string }>({
      method: 'PATCH',
      path: `/api/v1/documents/${documentId}`,
      body: { action: 'unarchive' }
    });

    return { success: response.success, message: response.message, status: response.status };
  }

  /**
   * Trigger re-extraction of a document
   * 
   * Useful when:
   * - Document extraction failed
   * - You want to try extraction with updated extractors
   * - Document was partially processed
   * 
   * Rate limited to 3 reprocesses per document per day.
   * 
   * @example
   * ```typescript
   * const result = await client.documents.reprocess('doc-uuid');
   * console.log(`Reprocessing initiated. ${result.reprocessesRemaining} retries remaining today.`);
   * 
   * // Then wait for extraction
   * const doc = await client.documents.waitForExtraction('doc-uuid');
   * ```
   */
  async reprocess(documentId: string): Promise<{
    success: boolean;
    message: string;
    status: string;
    reprocessesRemaining: number;
  }> {
    const response = await this.http.request<{
      success: boolean;
      message: string;
      documentId: string;
      status: string;
      reprocessesRemaining: number;
      traceId: string;
    }>({
      method: 'POST',
      path: `/api/v1/documents/${documentId}/reprocess`
    });

    return {
      success: response.success,
      message: response.message,
      status: response.status,
      reprocessesRemaining: response.reprocessesRemaining
    };
  }
}
