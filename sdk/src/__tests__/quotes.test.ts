import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QuotesModule, type Quote, type Carrier } from '../modules/quotes';
import { HttpClient } from '../utils/http';
import { NotFoundError } from '../types';

function createMockHttp() {
  return {
    request: vi.fn(),
    uploadFile: vi.fn(),
  } as unknown as HttpClient;
}

const mockCarrier: Carrier = {
  id: 'carrier-1',
  name: 'Hartford',
  supportedLines: ['GL', 'BOP', 'WC'],
  statesAvailable: ['CA', 'NY', 'TX'],
  averageQuoteTimeSeconds: 120,
  successRate: 0.85,
  queueDepth: 3,
};

const mockQuote: Quote = {
  id: 'quote-uuid-1',
  carrierId: 'carrier-1',
  carrierName: 'Hartford',
  status: 'pending',
  priority: 'normal',
  createdAt: '2026-01-01T00:00:00Z',
  estimatedWaitSeconds: 120,
};

describe('QuotesModule', () => {
  let http: ReturnType<typeof createMockHttp>;
  let quotes: QuotesModule;

  beforeEach(() => {
    http = createMockHttp();
    quotes = new QuotesModule(http as unknown as HttpClient);
  });

  describe('listCarriers', () => {
    it('calls GET /api/v1/quotes/carriers', async () => {
      const response = {
        success: true,
        carriers: [mockCarrier],
        count: 1,
        traceId: 'trace-1',
      };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      const result = await quotes.listCarriers();

      expect(result).toEqual(response);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/quotes/carriers',
      });
    });
  });

  describe('submit', () => {
    it('calls POST /api/v1/quotes with carrier list', async () => {
      const response = {
        success: true,
        queueIds: ['q-1', 'q-2'],
        carriers: [
          { id: 'carrier-1', name: 'Hartford' },
          { id: 'carrier-2', name: 'CNA' },
        ],
        message: '2 quote requests submitted',
        traceId: 'trace-1',
      };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      const result = await quotes.submit({
        carriers: ['carrier-1', 'carrier-2'],
        priority: 'high',
      });

      expect(result).toEqual(response);
      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/quotes',
        body: { carriers: ['carrier-1', 'carrier-2'], priority: 'high' },
      });
    });

    it('passes optional fields', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        queueIds: ['q-1'],
        carriers: [{ id: 'carrier-1', name: 'Hartford' }],
        message: 'submitted',
        traceId: 'trace-1',
      });

      await quotes.submit({
        carriers: ['carrier-1'],
        priority: 'low',
        coverageTypes: ['GL', 'WC'],
        scheduledFor: '2026-02-01T00:00:00Z',
      });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/quotes',
        body: {
          carriers: ['carrier-1'],
          priority: 'low',
          coverageTypes: ['GL', 'WC'],
          scheduledFor: '2026-02-01T00:00:00Z',
        },
      });
    });

    it('returns invalidCarriers and errors when present', async () => {
      const response = {
        success: true,
        queueIds: ['q-1'],
        carriers: [{ id: 'carrier-1', name: 'Hartford' }],
        invalidCarriers: ['nonexistent-carrier'],
        errors: ['Carrier nonexistent-carrier not found'],
        message: '1 of 2 submitted',
        traceId: 'trace-1',
      };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      const result = await quotes.submit({
        carriers: ['carrier-1', 'nonexistent-carrier'],
      });

      expect(result.invalidCarriers).toEqual(['nonexistent-carrier']);
      expect(result.errors).toEqual(['Carrier nonexistent-carrier not found']);
    });
  });

  describe('list', () => {
    it('calls GET /api/v1/quotes with no params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quotes: [mockQuote],
        count: 1,
        traceId: 'trace-1',
      });

      const result = await quotes.list();

      expect(result.quotes).toHaveLength(1);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/quotes',
      });
    });

    it('passes status filter', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quotes: [],
        count: 0,
        traceId: 'trace-1',
      });

      await quotes.list({ status: 'completed' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('status=completed');
    });

    it('passes limit filter', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quotes: [],
        count: 0,
        traceId: 'trace-1',
      });

      await quotes.list({ limit: 10 });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('limit=10');
    });
  });

  describe('get', () => {
    it('calls GET /api/v1/quotes/:id and returns quote with canCancel', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quote: mockQuote,
        actions: { canCancel: true },
        traceId: 'trace-1',
      });

      const result = await quotes.get('quote-uuid-1');

      expect(result.quote).toEqual(mockQuote);
      expect(result.canCancel).toBe(true);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/quotes/quote-uuid-1',
      });
    });

    it('returns canCancel: false for processing quotes', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quote: { ...mockQuote, status: 'processing' },
        actions: { canCancel: false },
        traceId: 'trace-1',
      });

      const result = await quotes.get('quote-uuid-1');
      expect(result.canCancel).toBe(false);
    });
  });

  describe('cancel', () => {
    it('calls DELETE /api/v1/quotes/:id', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        message: 'Quote cancelled',
        traceId: 'trace-1',
      });

      const result = await quotes.cancel('quote-uuid-1');

      expect(result).toEqual({ success: true, message: 'Quote cancelled' });
      expect(http.request).toHaveBeenCalledWith({
        method: 'DELETE',
        path: '/api/v1/quotes/quote-uuid-1',
      });
    });
  });

  describe('waitForCompletion', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns immediately when quote is already completed', async () => {
      const completedQuote = { ...mockQuote, status: 'completed' as const };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quote: completedQuote,
        actions: { canCancel: false },
        traceId: 'trace-1',
      });

      const result = await quotes.waitForCompletion('quote-uuid-1');
      expect(result.status).toBe('completed');
      expect(http.request).toHaveBeenCalledTimes(1);
    });

    it('returns when quote fails', async () => {
      const failedQuote = { ...mockQuote, status: 'failed' as const, error: 'Carrier unavailable' };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quote: failedQuote,
        actions: { canCancel: false },
        traceId: 'trace-1',
      });

      const result = await quotes.waitForCompletion('quote-uuid-1');
      expect(result.status).toBe('failed');
    });

    it('returns when quote is cancelled', async () => {
      const cancelledQuote = { ...mockQuote, status: 'cancelled' as const };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quote: cancelledQuote,
        actions: { canCancel: false },
        traceId: 'trace-1',
      });

      const result = await quotes.waitForCompletion('quote-uuid-1');
      expect(result.status).toBe('cancelled');
    });

    it('returns when an instant quote was referred to an underwriter', async () => {
      const referredQuote = { ...mockQuote, status: 'processing' as const, outcome: 'referred' };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quote: referredQuote,
        actions: { canCancel: false },
        traceId: 'trace-1',
      });

      const result = await quotes.waitForCompletion('quote-uuid-1');
      expect(result.outcome).toBe('referred');
      expect(http.request).toHaveBeenCalledTimes(1);
    });

    it('polls until quote completes', async () => {
      let callCount = 0;
      (http.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        const status = callCount < 3 ? 'processing' : 'completed';
        return {
          success: true,
          quote: { ...mockQuote, status },
          actions: { canCancel: false },
          traceId: 'trace-1',
        };
      });

      const promise = quotes.waitForCompletion('quote-uuid-1', { pollIntervalMs: 1000 });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result.status).toBe('completed');
      expect(callCount).toBe(3);
    });

    it('throws on timeout', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        quote: { ...mockQuote, status: 'processing' },
        actions: { canCancel: false },
        traceId: 'trace-1',
      });

      const promise = quotes.waitForCompletion('quote-uuid-1', {
        timeoutMs: 3000,
        pollIntervalMs: 1000,
      });

      // Attach rejection handler before advancing timers to avoid unhandled rejection
      const rejection = expect(promise).rejects.toThrow('did not complete within');
      await vi.advanceTimersByTimeAsync(4000);
      await rejection;
    });

    it('throws when quote is not found (404)', async () => {
      const notFound = new NotFoundError('Quote quote-uuid-1 not found');
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(notFound);

      await expect(
        quotes.waitForCompletion('quote-uuid-1')
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('continues polling on transient errors', async () => {
      let callCount = 0;
      (http.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('Network timeout');
        return {
          success: true,
          quote: { ...mockQuote, status: 'completed' },
          actions: { canCancel: false },
          traceId: 'trace-1',
        };
      });

      const promise = quotes.waitForCompletion('quote-uuid-1', { pollIntervalMs: 1000 });

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result.status).toBe('completed');
      expect(callCount).toBe(2);
    });

    it('uses default 5 minute timeout and 5 second poll interval', async () => {
      // Just verify the method accepts no options (uses defaults)
      let callCount = 0;
      (http.request as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        return {
          success: true,
          quote: { ...mockQuote, status: callCount > 1 ? 'completed' : 'pending' },
          actions: { canCancel: true },
          traceId: 'trace-1',
        };
      });

      const promise = quotes.waitForCompletion('quote-uuid-1');

      // Default poll interval is 5000ms
      await vi.advanceTimersByTimeAsync(5000);

      const result = await promise;
      expect(result.status).toBe('completed');
    });
  });
});
