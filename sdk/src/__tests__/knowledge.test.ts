import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  KnowledgeModule,
  type KnowledgeSearchResult,
  type Notecard,
  type DocumentFacts,
} from '../modules/knowledge';
import { HttpClient } from '../utils/http';
import { NotFoundError, ValidationError } from '../types';

function createMockHttp() {
  return {
    request: vi.fn(),
    uploadFile: vi.fn(),
  } as unknown as HttpClient;
}

const mockSearchResult: KnowledgeSearchResult = {
  id: 'result-1',
  type: 'notecard',
  title: 'GL Policy Summary',
  summary: 'General liability coverage details for ABC Construction',
  score: 0.92,
  notecardId: 'nc-uuid-1',
  highlights: ['General liability', 'ABC Construction'],
  metadata: { source: 'notecard', templateType: 'policy_summary' },
};

const mockDocumentChunkResult: KnowledgeSearchResult = {
  id: 'result-2',
  type: 'document_chunk',
  title: 'GL Policy 2026 — Page 3',
  summary: 'Occurrence limit details',
  score: 0.78,
  documentId: 'doc-uuid-1',
  chunkId: 'chunk-uuid-1',
  highlights: ['occurrence limit', '$1,000,000'],
  metadata: { pageIndex: 3 },
};

const mockNotecard: Notecard = {
  id: 'nc-uuid-1',
  tocPath: 'insurance/policies/gl',
  templateType: 'policy_summary',
  title: 'GL Policy Summary',
  summary: 'General liability policy for ABC Construction',
  content: '<strong>Carrier:</strong> Hartford\n<strong>Limit:</strong> $1M',
  validFrom: '2026-01-01',
  validTo: '2027-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
};

const mockDocumentFacts: DocumentFacts = {
  policies: [
    {
      id: 'pol-1',
      policyType: 'GL',
      policyNumber: 'GL-001-2026',
      carrierName: 'Hartford',
      effectiveDate: '2026-01-01',
      expirationDate: '2027-01-01',
      premium: 5000,
      coverageLimit: 1000000,
    },
  ],
  dates: {
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
  },
  carriers: ['Hartford'],
  coverages: [
    { type: 'General Aggregate', limit: 2000000, deductible: 1000 },
    { type: 'Each Occurrence', limit: 1000000 },
  ],
};

describe('KnowledgeModule', () => {
  let http: ReturnType<typeof createMockHttp>;
  let knowledge: KnowledgeModule;

  beforeEach(() => {
    http = createMockHttp();
    knowledge = new KnowledgeModule(http as unknown as HttpClient);
  });

  // ============================================================
  // search()
  // ============================================================
  describe('search', () => {
    it('calls POST /api/v1/knowledge/search with query body', async () => {
      const serverResponse = {
        success: true,
        data: [mockSearchResult],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(serverResponse);

      const result = await knowledge.search({ query: 'general liability' });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/knowledge/search',
        body: { query: 'general liability' },
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(mockSearchResult);
      expect(result.pagination).toEqual(serverResponse.pagination);
    });

    it('includes types filter in request body', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      await knowledge.search({ query: 'policy', types: ['notecard'] });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/knowledge/search',
        body: { query: 'policy', types: ['notecard'] },
      });
    });

    it('includes both types in request body', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockSearchResult, mockDocumentChunkResult],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      const result = await knowledge.search({
        query: 'GL coverage',
        types: ['notecard', 'document_chunk'],
      });

      const body = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
      expect(body.types).toEqual(['notecard', 'document_chunk']);
      expect(result.data).toHaveLength(2);
    });

    it('includes limit in request body', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      await knowledge.search({ query: 'carrier', limit: 5 });

      const body = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
      expect(body.limit).toBe(5);
    });

    it('throws ValidationError when query is empty string', async () => {
      await expect(knowledge.search({ query: '' })).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when query is whitespace only', async () => {
      await expect(knowledge.search({ query: '   ' })).rejects.toThrow(ValidationError);
    });

    it('ValidationError message is meaningful', async () => {
      await expect(knowledge.search({ query: '' })).rejects.toThrow('query');
    });

    it('does not call http.request when validation fails', async () => {
      try {
        await knowledge.search({ query: '' });
      } catch {
        // expected
      }
      expect(http.request).not.toHaveBeenCalled();
    });

    it('returns pagination with hasMore true when more results exist', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockSearchResult],
        pagination: { cursor: 'cur-1', nextCursor: 'cur-2', hasMore: true },
        traceId: 'trace-1',
      });

      const result = await knowledge.search({ query: 'policy' });

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe('cur-2');
    });

    it('returns document_chunk results with expected shape', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockDocumentChunkResult],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      const result = await knowledge.search({ query: 'occurrence limit' });

      const chunk = result.data[0];
      expect(chunk.type).toBe('document_chunk');
      expect(chunk.documentId).toBe('doc-uuid-1');
      expect(chunk.chunkId).toBe('chunk-uuid-1');
      expect(chunk.highlights).toContain('$1,000,000');
    });
  });

  // ============================================================
  // notecards()
  // ============================================================
  describe('notecards', () => {
    it('calls GET /api/v1/knowledge/notecards with no options', async () => {
      const serverResponse = {
        success: true,
        data: [mockNotecard],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(serverResponse);

      const result = await knowledge.notecards();

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/knowledge/notecards',
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(mockNotecard);
    });

    it('appends type query param', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      await knowledge.notecards({ type: 'policy_summary' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('type=policy_summary');
    });

    it('appends limit query param', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      await knowledge.notecards({ limit: 20 });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('limit=20');
    });

    it('appends cursor query param', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { cursor: 'cur-abc', nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      await knowledge.notecards({ cursor: 'cur-abc' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('cursor=cur-abc');
    });

    it('combines all query params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      await knowledge.notecards({ type: 'carrier_summary', limit: 10, cursor: 'next-page' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('type=carrier_summary');
      expect(calledPath).toContain('limit=10');
      expect(calledPath).toContain('cursor=next-page');
    });

    it('returns correct pagination shape', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockNotecard],
        pagination: { cursor: 'pg-1', nextCursor: 'pg-2', hasMore: true },
        traceId: 'trace-1',
      });

      const result = await knowledge.notecards();

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe('pg-2');
    });

    it('returns notecard with all expected fields', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockNotecard],
        pagination: { cursor: null, nextCursor: null, hasMore: false },
        traceId: 'trace-1',
      });

      const result = await knowledge.notecards();
      const nc = result.data[0];

      expect(nc.id).toBe('nc-uuid-1');
      expect(nc.tocPath).toBe('insurance/policies/gl');
      expect(nc.templateType).toBe('policy_summary');
      expect(nc.content).toContain('Hartford');
      expect(nc.validFrom).toBe('2026-01-01');
      expect(nc.createdAt).toBe('2026-01-01T00:00:00Z');
    });
  });

  // ============================================================
  // documentFacts()
  // ============================================================
  describe('documentFacts', () => {
    it('calls GET /api/v1/knowledge/documents/:id/facts', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDocumentFacts,
        traceId: 'trace-1',
      });

      const result = await knowledge.documentFacts('doc-uuid-1');

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/knowledge/documents/doc-uuid-1/facts',
      });
      expect(result).toEqual(mockDocumentFacts);
    });

    it('returns full facts shape with policies, dates, carriers, coverages', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDocumentFacts,
        traceId: 'trace-1',
      });

      const result = await knowledge.documentFacts('doc-uuid-1');

      expect(result.policies).toHaveLength(1);
      expect(result.policies[0].policyType).toBe('GL');
      expect(result.policies[0].carrierName).toBe('Hartford');
      expect(result.dates.effectiveDate).toBe('2026-01-01');
      expect(result.carriers).toContain('Hartford');
      expect(result.coverages).toHaveLength(2);
      expect(result.coverages[0].type).toBe('General Aggregate');
      expect(result.coverages[0].limit).toBe(2000000);
    });

    it('interpolates documentId into the URL path', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDocumentFacts,
        traceId: 'trace-1',
      });

      await knowledge.documentFacts('some-other-doc-id');

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/knowledge/documents/some-other-doc-id/facts',
      });
    });

    it('throws NotFoundError when document does not exist', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Document not found', 'trace-404')
      );

      await expect(knowledge.documentFacts('nonexistent-doc-id')).rejects.toThrow(NotFoundError);
    });

    it('propagates non-NotFoundError errors', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Internal server error')
      );

      await expect(knowledge.documentFacts('doc-uuid-1')).rejects.toThrow('Internal server error');
    });
  });
});
