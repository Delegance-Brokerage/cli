import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DocumentsModule } from '../modules/documents';
import { HttpClient } from '../utils/http';
import { ValidationError, type Document, type DocumentWithExtraction } from '../types';

function createMockHttp() {
  return {
    request: vi.fn(),
    uploadFile: vi.fn(),
  } as unknown as HttpClient;
}

const mockDocument: Document = {
  id: 'doc-uuid-1',
  companyId: 'comp-uuid-1',
  fileName: 'GL-2025.pdf',
  documentType: 'policy',
  status: 'pending',
  fileSize: 1024,
  createdAt: '2026-01-01T00:00:00Z',
};

const mockDocWithExtraction: DocumentWithExtraction = {
  ...mockDocument,
  status: 'completed',
  extraction: {
    hasText: true,
    textLength: 5000,
    policies: [
      {
        id: 'pol-1',
        policyType: 'General Liability',
        policyNumber: 'GL-001',
        carrierName: 'Hartford',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        premium: 5000,
        coverageLimit: 1000000,
      },
    ],
  },
};

describe('DocumentsModule', () => {
  let http: ReturnType<typeof createMockHttp>;
  let documents: DocumentsModule;

  beforeEach(() => {
    http = createMockHttp();
    documents = new DocumentsModule(http as unknown as HttpClient);
  });

  describe('upload', () => {
    it('uploads a file via uploadFile with correct fields', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: mockDocument,
        message: 'Document uploaded',
        traceId: 'trace-1',
      });

      const file = Buffer.from('pdf content');
      const result = await documents.upload({
        companyId: 'comp-uuid-1',
        file,
        fileName: 'GL-2025.pdf',
        documentType: 'policy',
      });

      expect(result).toEqual(mockDocument);
      expect(http.uploadFile).toHaveBeenCalledWith(
        '/api/v1/documents',
        file,
        'GL-2025.pdf',
        { companyId: 'comp-uuid-1', documentType: 'policy' }
      );
    });

    it('converts base64 string to Buffer', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: mockDocument,
        message: 'Document uploaded',
        traceId: 'trace-1',
      });

      const base64Content = Buffer.from('hello').toString('base64');
      await documents.upload({
        companyId: 'comp-uuid-1',
        file: base64Content,
        fileName: 'test.pdf',
      });

      // First arg is path, second is the converted buffer
      const uploadedFile = (http.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(Buffer.isBuffer(uploadedFile)).toBe(true);
    });

    it('passes Blob directly', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: mockDocument,
        message: 'uploaded',
        traceId: 'trace-1',
      });

      const blob = new Blob(['content']);
      await documents.upload({
        companyId: 'comp-uuid-1',
        file: blob,
        fileName: 'test.pdf',
      });

      const uploadedFile = (http.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(uploadedFile).toBe(blob);
    });

    it('includes externalId and metadata in additional fields', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: mockDocument,
        message: 'uploaded',
        traceId: 'trace-1',
      });

      await documents.upload({
        companyId: 'comp-uuid-1',
        file: Buffer.from('data'),
        fileName: 'test.pdf',
        externalId: 'ext-doc-1',
        metadata: { source: 'api', tags: ['important'] },
      });

      const additionalFields = (http.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0][3];
      expect(additionalFields.externalId).toBe('ext-doc-1');
      expect(additionalFields.metadata).toBe(JSON.stringify({ source: 'api', tags: ['important'] }));
    });

    it('omits companyId when not given, so the server uses the key\'s own company', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, document: mockDocument });
      await documents.upload({ file: Buffer.from('x'), fileName: 'test.pdf' });
      const additionalFields = (http.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0][3] as Record<string, string>;
      expect(additionalFields).not.toHaveProperty('companyId');
    });

    it('throws ValidationError when file is missing', async () => {
      await expect(
        documents.upload({ companyId: 'comp-1', file: null as never, fileName: 'test.pdf' })
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when fileName is missing', async () => {
      await expect(
        documents.upload({ companyId: 'comp-1', file: Buffer.from('x'), fileName: '' })
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('uploadBatch', () => {
    it('uploads multiple documents and returns results', async () => {
      const doc1 = { ...mockDocument, id: 'doc-1' };
      const doc2 = { ...mockDocument, id: 'doc-2' };

      (http.uploadFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true, document: doc1, message: 'ok', traceId: 't1' })
        .mockResolvedValueOnce({ success: true, document: doc2, message: 'ok', traceId: 't2' });

      const inputs = [
        { companyId: 'comp-1', file: Buffer.from('a'), fileName: 'a.pdf' },
        { companyId: 'comp-1', file: Buffer.from('b'), fileName: 'b.pdf' },
      ];

      const result = await documents.uploadBatch(inputs);

      expect(result.documents).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('captures individual upload errors without failing the batch', async () => {
      const doc1 = { ...mockDocument, id: 'doc-1' };

      (http.uploadFile as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ success: true, document: doc1, message: 'ok', traceId: 't1' })
        .mockRejectedValueOnce(new Error('Upload failed'));

      const inputs = [
        { companyId: 'comp-1', file: Buffer.from('a'), fileName: 'a.pdf' },
        { companyId: 'comp-1', file: Buffer.from('b'), fileName: 'b.pdf' },
      ];

      const result = await documents.uploadBatch(inputs);

      expect(result.documents).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error.message).toBe('Upload failed');
    });

    it('respects concurrency option', async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      (http.uploadFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise(r => setTimeout(r, 10));
        concurrentCalls--;
        return { success: true, document: mockDocument, message: 'ok', traceId: 't' };
      });

      const inputs = Array.from({ length: 6 }, (_, i) => ({
        companyId: 'comp-1',
        file: Buffer.from(`file-${i}`),
        fileName: `file-${i}.pdf`,
      }));

      await documents.uploadBatch(inputs, { concurrency: 2 });

      // With concurrency 2, batches of 2 are processed. Within each batch,
      // Promise.allSettled runs them concurrently.
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('defaults to concurrency of 3', async () => {
      let concurrentCalls = 0;
      let maxConcurrent = 0;

      (http.uploadFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        concurrentCalls++;
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
        await new Promise(r => setTimeout(r, 10));
        concurrentCalls--;
        return { success: true, document: mockDocument, message: 'ok', traceId: 't' };
      });

      const inputs = Array.from({ length: 9 }, (_, i) => ({
        companyId: 'comp-1',
        file: Buffer.from(`file-${i}`),
        fileName: `file-${i}.pdf`,
      }));

      await documents.uploadBatch(inputs);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
  });

  describe('get', () => {
    it('calls GET /api/v1/documents/:id and returns document with extraction', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: mockDocWithExtraction,
        extraction: mockDocWithExtraction.extraction,
        processing: undefined,
        error: undefined,
        traceId: 'trace-1',
      });

      const result = await documents.get('doc-uuid-1');

      expect(result.id).toBe('doc-uuid-1');
      expect(result.extraction).toBeDefined();
      expect(result.extraction!.policies).toHaveLength(1);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/documents/doc-uuid-1',
      });
    });

    it('includes processing info for in-progress documents', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: { ...mockDocument, status: 'processing' },
        processing: { message: 'Extracting text', estimatedTimeSeconds: 30 },
        traceId: 'trace-1',
      });

      const result = await documents.get('doc-uuid-1');
      expect(result.processing).toEqual({ message: 'Extracting text', estimatedTimeSeconds: 30 });
    });

    it('includes error info for failed documents', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: { ...mockDocument, status: 'error' },
        error: { message: 'Extraction failed', code: 'EXTRACTION_ERROR' },
        traceId: 'trace-1',
      });

      const result = await documents.get('doc-uuid-1');
      expect(result.error).toEqual({ message: 'Extraction failed', code: 'EXTRACTION_ERROR' });
    });
  });

  describe('list', () => {
    it('calls GET /api/v1/documents with no params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        documents: [mockDocument],
        pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
        traceId: 'trace-1',
      });

      const result = await documents.list();

      expect(result.documents).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/documents',
      });
    });

    it('passes all filter options as query params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        documents: [],
        pagination: { total: 0, limit: 10, offset: 20, hasMore: false },
        traceId: 'trace-1',
      });

      await documents.list({
        companyId: 'comp-1',
        documentType: 'policy',
        status: 'completed',
        limit: 10,
        offset: 20,
      });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path as string;
      expect(calledPath).toContain('companyId=comp-1');
      expect(calledPath).toContain('documentType=policy');
      expect(calledPath).toContain('status=completed');
      expect(calledPath).toContain('limit=10');
      expect(calledPath).toContain('offset=20');
    });
  });

  describe('waitForExtraction', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns immediately when document is already completed', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: { ...mockDocument, status: 'completed' },
        extraction: mockDocWithExtraction.extraction,
        traceId: 'trace-1',
      });

      const promise = documents.waitForExtraction('doc-uuid-1');
      const result = await promise;

      expect(result.status).toBe('completed');
      expect(http.request).toHaveBeenCalledTimes(1);
    });

    it('returns when document reaches processed status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: { ...mockDocument, status: 'processed' },
        traceId: 'trace-1',
      });

      const result = await documents.waitForExtraction('doc-uuid-1');
      expect(result.status).toBe('processed');
    });

    it('returns when document has error status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: { ...mockDocument, status: 'error' },
        error: { message: 'Failed' },
        traceId: 'trace-1',
      });

      const result = await documents.waitForExtraction('doc-uuid-1');
      expect(result.status).toBe('error');
    });

    it('returns when document has failed status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: { ...mockDocument, status: 'failed' },
        traceId: 'trace-1',
      });

      const result = await documents.waitForExtraction('doc-uuid-1');
      expect(result.status).toBe('failed');
    });

    it('polls until status changes to completed', async () => {
      let callCount = 0;
      (http.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        const status = callCount < 3 ? 'processing' : 'completed';
        return {
          success: true,
          document: { ...mockDocument, status },
          extraction: status === 'completed' ? mockDocWithExtraction.extraction : undefined,
          traceId: 'trace-1',
        };
      });

      const promise = documents.waitForExtraction('doc-uuid-1', { pollIntervalMs: 1000 });

      // Advance timers for the polling intervals
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.status).toBe('completed');
      expect(callCount).toBe(3);
    });

    it('calls onStatusChange when status changes', async () => {
      let callCount = 0;
      (http.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        let status: string;
        if (callCount === 1) status = 'pending';
        else if (callCount === 2) status = 'processing';
        else status = 'completed';
        return {
          success: true,
          document: { ...mockDocument, status },
          traceId: 'trace-1',
        };
      });

      const statusChanges: string[] = [];
      const onStatusChange = (status: string) => statusChanges.push(status);

      const promise = documents.waitForExtraction('doc-uuid-1', {
        pollIntervalMs: 1000,
        onStatusChange,
      });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      await promise;

      expect(statusChanges).toEqual(['pending', 'processing', 'completed']);
    });

    it('does not call onStatusChange when status is the same', async () => {
      let callCount = 0;
      (http.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        const status = callCount < 3 ? 'processing' : 'completed';
        return {
          success: true,
          document: { ...mockDocument, status },
          traceId: 'trace-1',
        };
      });

      const statusChanges: string[] = [];
      const promise = documents.waitForExtraction('doc-uuid-1', {
        pollIntervalMs: 1000,
        onStatusChange: (s) => statusChanges.push(s),
      });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      await promise;

      // 'processing' should only appear once even though it was returned twice
      expect(statusChanges).toEqual(['processing', 'completed']);
    });

    it('throws on timeout', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        document: { ...mockDocument, status: 'processing' },
        traceId: 'trace-1',
      });

      const promise = documents.waitForExtraction('doc-uuid-1', {
        timeoutMs: 5000,
        pollIntervalMs: 2000,
      });

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const rejection = expect(promise).rejects.toThrow('did not complete within');

      // Advance past the timeout
      await vi.advanceTimersByTimeAsync(6000);

      await rejection;
    });
  });

  describe('findByExternalId', () => {
    it('returns matching document', async () => {
      const docWithExtId = { ...mockDocument, externalId: 'ext-doc-1' };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        documents: [docWithExtId],
        pagination: { total: 1, limit: 1, offset: 0, hasMore: false },
        traceId: 'trace-1',
      });

      const result = await documents.findByExternalId('ext-doc-1');
      expect(result).toEqual(docWithExtId);

      // Verify externalId query param is passed to the server
      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path as string;
      expect(calledPath).toContain('externalId=ext-doc-1');
    });

    it('returns null when documents list is empty', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        documents: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
        traceId: 'trace-1',
      });

      const result = await documents.findByExternalId('ext-doc-1');
      expect(result).toBeNull();
    });

    it('passes companyId filter when provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        documents: [],
        pagination: { total: 0, limit: 1, offset: 0, hasMore: false },
        traceId: 'trace-1',
      });

      await documents.findByExternalId('ext-doc-1', 'comp-1');

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path as string;
      expect(calledPath).toContain('externalId=ext-doc-1');
      expect(calledPath).toContain('companyId=comp-1');
      expect(calledPath).toContain('limit=1');
    });
  });

  describe('archive', () => {
    it('calls PATCH /api/v1/documents/:id with action: archive', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        message: 'Document archived',
        traceId: 'trace-1',
      });

      const result = await documents.archive('doc-uuid-1');

      expect(result).toEqual({ success: true, message: 'Document archived' });
      expect(http.request).toHaveBeenCalledWith({
        method: 'PATCH',
        path: '/api/v1/documents/doc-uuid-1',
        body: { action: 'archive' },
      });
    });
  });

  describe('unarchive', () => {
    it('calls PATCH /api/v1/documents/:id with action: unarchive', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        message: 'Document restored',
        status: 'completed',
        traceId: 'trace-1',
      });

      const result = await documents.unarchive('doc-uuid-1');

      expect(result).toEqual({ success: true, message: 'Document restored', status: 'completed' });
      expect(http.request).toHaveBeenCalledWith({
        method: 'PATCH',
        path: '/api/v1/documents/doc-uuid-1',
        body: { action: 'unarchive' },
      });
    });
  });

  describe('reprocess', () => {
    it('calls POST /api/v1/documents/:id/reprocess', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        message: 'Reprocessing initiated',
        documentId: 'doc-uuid-1',
        status: 'processing',
        reprocessesRemaining: 2,
        traceId: 'trace-1',
      });

      const result = await documents.reprocess('doc-uuid-1');

      expect(result).toEqual({
        success: true,
        message: 'Reprocessing initiated',
        status: 'processing',
        reprocessesRemaining: 2,
      });
      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/documents/doc-uuid-1/reprocess',
      });
    });
  });
});
