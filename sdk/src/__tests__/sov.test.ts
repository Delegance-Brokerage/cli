import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SOVModule } from '../modules/sov';
import type { HttpClient } from '../utils/http';
import { NotFoundError } from '../types';

function mockHttp(): HttpClient {
  return { request: vi.fn(), uploadFile: vi.fn() } as unknown as HttpClient;
}

describe('SOVModule', () => {
  let http: HttpClient;
  let sov: SOVModule;

  beforeEach(() => {
    http = mockHttp();
    sov = new SOVModule(http);
  });

  describe('upload', () => {
    it('calls uploadFile with correct path and fields', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sovId: 'sov-1',
        s3Key: 'sov/sov-1.xlsx',
        status: 'uploaded',
        message: 'SOV uploaded',
        traceId: 't-1',
      });

      const file = Buffer.from('spreadsheet data');
      const result = await sov.upload({
        file,
        fileName: 'schedule.xlsx',
        lineOfBusiness: 'property',
        effectiveDate: '2026-01-01',
      });

      expect(http.uploadFile).toHaveBeenCalledWith(
        '/api/v1/sov',
        file,
        'schedule.xlsx',
        { lineOfBusiness: 'property', effectiveDate: '2026-01-01' }
      );
      expect(result.sovId).toBe('sov-1');
    });

    it('handles Blob input', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sovId: 'sov-2',
        s3Key: 'sov/sov-2.xlsx',
        status: 'uploaded',
        message: 'ok',
        traceId: 't-2',
      });

      const blob = new Blob(['data']);
      await sov.upload({ file: blob, fileName: 'test.xlsx' });

      expect(http.uploadFile).toHaveBeenCalledWith('/api/v1/sov', blob, 'test.xlsx', {});
    });

    it('handles ArrayBuffer input by converting to Blob', async () => {
      (http.uploadFile as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sovId: 'sov-3',
        s3Key: 'sov/sov-3.xlsx',
        status: 'uploaded',
        message: 'ok',
        traceId: 't-3',
      });

      const ab = new ArrayBuffer(8);
      await sov.upload({ file: ab, fileName: 'test.xlsx' });

      // ArrayBuffer should be converted to Blob before calling uploadFile
      const uploadedFile = (http.uploadFile as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(uploadedFile).toBeInstanceOf(Blob);
    });
  });

  describe('list', () => {
    it('calls GET /api/v1/sov with no params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sovs: [],
        count: 0,
        traceId: 't-1',
      });

      await sov.list();
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/sov',
      });
    });

    it('adds status and limit params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sovs: [],
        count: 0,
        traceId: 't-1',
      });

      await sov.list({ status: 'validated', limit: 25 });
      const path = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(path).toContain('status=validated');
      expect(path).toContain('limit=25');
    });
  });

  describe('get', () => {
    it('calls GET /api/v1/sov/:id', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sov: { id: 'sov-1', status: 'parsed', totalLocations: 5, totalTIV: 5000000 },
        traceId: 't-1',
      });

      const result = await sov.get('sov-1');
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/sov/sov-1',
      });
      expect(result.sov.totalLocations).toBe(5);
    });

    it('adds includeLocations and pagination params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sov: { id: 'sov-1', status: 'parsed' },
        locations: {
          items: [{ id: 'loc-1', locationNumber: 1 }],
          pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
        },
        traceId: 't-1',
      });

      await sov.get('sov-1', {
        includeLocations: true,
        locationLimit: 50,
        locationOffset: 100,
      });

      const path = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(path).toContain('includeLocations=true');
      expect(path).toContain('locationLimit=50');
      expect(path).toContain('locationOffset=100');
    });
  });

  describe('waitForParsing', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('resolves when SOV is parsed', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sov: { id: 'sov-1', status: 'parsed', totalLocations: 10 },
        traceId: 't-1',
      });

      const result = await sov.waitForParsing('sov-1');
      expect(result.status).toBe('parsed');
    });

    it('resolves on validated status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sov: { id: 'sov-1', status: 'validated' },
        traceId: 't-1',
      });

      const result = await sov.waitForParsing('sov-1');
      expect(result.status).toBe('validated');
    });

    it('resolves on error status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sov: { id: 'sov-1', status: 'error', parsingErrors: ['Bad format'] },
        traceId: 't-1',
      });

      const result = await sov.waitForParsing('sov-1');
      expect(result.status).toBe('error');
    });

    it('polls until status changes', async () => {
      let callCount = 0;
      (http.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        return {
          success: true,
          sov: { id: 'sov-1', status: callCount < 3 ? 'parsing' : 'parsed' },
          traceId: 't-1',
        };
      });

      const promise = sov.waitForParsing('sov-1', { pollIntervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result.status).toBe('parsed');
      expect(callCount).toBe(3);
    });

    it('throws on timeout', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        sov: { id: 'sov-1', status: 'parsing' },
        traceId: 't-1',
      });

      const promise = sov.waitForParsing('sov-1', { timeoutMs: 3000, pollIntervalMs: 1000 });
      const rejection = expect(promise).rejects.toThrow('did not complete parsing within');
      await vi.advanceTimersByTimeAsync(4000);
      await rejection;
    });

    it('throws when SOV not found', async () => {
      const notFound = new NotFoundError('SOV sov-1 not found');
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(notFound);

      await expect(sov.waitForParsing('sov-1')).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
