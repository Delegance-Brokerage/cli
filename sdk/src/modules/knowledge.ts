/**
 * Knowledge Module
 *
 * Search notecards and document chunks, list notecards, and
 * retrieve structured facts extracted from documents.
 */

import { HttpClient } from '../utils/http';
import { ValidationError } from '../types';

// ============================================================
// Public types
// ============================================================

export interface KnowledgeSearchResult {
  id: string;
  type: 'notecard' | 'document_chunk';
  title: string;
  summary: string;
  score: number;
  documentId?: string;
  notecardId?: string;
  chunkId?: string;
  highlights: string[];
  metadata: Record<string, unknown>;
}

export interface Notecard {
  id: string;
  tocPath: string;
  templateType: string;
  title: string;
  summary: string;
  content: string;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface DocumentFacts {
  policies: Array<{
    id: string;
    policyType: string;
    policyNumber?: string;
    carrierName?: string;
    effectiveDate?: string;
    expirationDate?: string;
    premium?: number;
    coverageLimit?: number;
  }>;
  dates: Record<string, string>;
  carriers: string[];
  coverages: Array<{ type: string; limit?: number; deductible?: number }>;
}

export interface SearchInput {
  query: string;
  types?: ('notecard' | 'document_chunk')[];
  limit?: number;
}

export interface ListNotecardsOptions {
  type?: string;
  limit?: number;
  cursor?: string;
}

// ============================================================
// Internal response shapes (server contract)
// ============================================================

interface KnowledgePagination {
  cursor: string | null;
  nextCursor: string | null;
  hasMore: boolean;
}

interface SearchResponse {
  success: boolean;
  data: KnowledgeSearchResult[];
  pagination: KnowledgePagination;
  traceId: string;
}

interface ListNotecardsResponse {
  success: boolean;
  data: Notecard[];
  pagination: KnowledgePagination;
  traceId: string;
}

interface DocumentFactsResponse {
  success: boolean;
  data: DocumentFacts;
  traceId: string;
}

// ============================================================
// Module
// ============================================================

export class KnowledgeModule {
  constructor(private http: HttpClient) {}

  /**
   * Search notecards and document chunks using semantic search.
   *
   * Uses POST because the query body can be complex (filters, types, etc.).
   *
   * @example
   * ```typescript
   * const { data, pagination } = await client.knowledge.search({
   *   query: 'general liability occurrence limit',
   *   types: ['notecard'],
   *   limit: 10,
   * });
   * console.log(data[0].title, data[0].score);
   * ```
   */
  async search(input: SearchInput): Promise<{ data: KnowledgeSearchResult[]; pagination: KnowledgePagination }> {
    if (!input.query || !input.query.trim()) {
      throw new ValidationError('search query must be a non-empty string');
    }

    const body: Record<string, unknown> = { query: input.query };
    if (input.types !== undefined) body.types = input.types;
    if (input.limit !== undefined) body.limit = input.limit;

    const response = await this.http.request<SearchResponse>({
      method: 'POST',
      path: '/api/v1/knowledge/search',
      body,
    });

    return { data: response.data, pagination: response.pagination };
  }

  /**
   * List notecards, optionally filtered by template type.
   *
   * @example
   * ```typescript
   * const { data, pagination } = await client.knowledge.notecards({
   *   type: 'policy_summary',
   *   limit: 50,
   * });
   * if (pagination.hasMore) {
   *   const next = await client.knowledge.notecards({ cursor: pagination.nextCursor! });
   * }
   * ```
   */
  async notecards(options: ListNotecardsOptions = {}): Promise<{ data: Notecard[]; pagination: KnowledgePagination }> {
    const params = new URLSearchParams();
    if (options.type) params.set('type', options.type);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    if (options.cursor) params.set('cursor', options.cursor);

    const query = params.toString();
    const path = query
      ? `/api/v1/knowledge/notecards?${query}`
      : '/api/v1/knowledge/notecards';

    const response = await this.http.request<ListNotecardsResponse>({
      method: 'GET',
      path,
    });

    return { data: response.data, pagination: response.pagination };
  }

  /**
   * Retrieve structured facts extracted from a document.
   *
   * @throws {NotFoundError} when the document does not exist
   *
   * @example
   * ```typescript
   * const facts = await client.knowledge.documentFacts('doc-uuid');
   * console.log(facts.carriers);          // ['Hartford', 'Chubb']
   * console.log(facts.policies[0].policyType); // 'GL'
   * ```
   */
  async documentFacts(documentId: string): Promise<DocumentFacts> {
    const response = await this.http.request<DocumentFactsResponse>({
      method: 'GET',
      path: `/api/v1/knowledge/documents/${documentId}/facts`,
    });

    return response.data;
  }
}
