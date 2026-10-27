import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageModule } from '../modules/usage';
import { ValidationError } from '../types';
import type { HttpClient } from '../utils/http';

function createMockHttp(): HttpClient {
  return { request: vi.fn(), uploadFile: vi.fn() } as unknown as HttpClient;
}

const mockMeterUsage = {
  used: 150,
  included: 100,
  overage: 50,
  overageCostCents: 500,
};

const mockUsageSummary = {
  period: '2026-04',
  plan: 'growth',
  status: 'estimated' as const,
  meters: {
    api_requests: mockMeterUsage,
    documents: { used: 10, included: 20, overage: 0, overageCostCents: 0 },
  },
  totalOverageCents: 500,
  asOf: '2026-04-01T00:00:00Z',
};

const mockDailyUsage = [
  { date: '2026-04-01', meter: 'api_requests', quantity: 42 },
  { date: '2026-04-02', meter: 'api_requests', quantity: 58 },
];

const mockRateLimitStatus = {
  requestsPerMinute: 60,
  remaining: 45,
  resetsAt: '2026-04-01T12:01:00Z',
};

describe('UsageModule', () => {
  let http: HttpClient;
  let usage: UsageModule;

  beforeEach(() => {
    http = createMockHttp();
    usage = new UsageModule(http);
  });

  // ============================================
  // summary()
  // ============================================

  describe('summary', () => {
    it('sends GET /api/v1/usage/summary', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockUsageSummary,
        traceId: 'trace-1',
      });

      await usage.summary();

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/usage/summary',
      });
    });

    it('returns full UsageSummary shape', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockUsageSummary,
        traceId: 'trace-1',
      });

      const result = await usage.summary();

      expect(result.period).toBe('2026-04');
      expect(result.plan).toBe('growth');
      expect(result.status).toBe('estimated');
      expect(result.totalOverageCents).toBe(500);
      expect(result.asOf).toBe('2026-04-01T00:00:00Z');
    });

    it('returns meters map with MeterUsage values', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockUsageSummary,
        traceId: 'trace-1',
      });

      const result = await usage.summary();

      expect(result.meters['api_requests'].used).toBe(150);
      expect(result.meters['api_requests'].included).toBe(100);
      expect(result.meters['api_requests'].overage).toBe(50);
      expect(result.meters['api_requests'].overageCostCents).toBe(500);
    });

    it('returns status as "invoiced" when response contains invoiced status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { ...mockUsageSummary, status: 'invoiced' },
        traceId: 'trace-2',
      });

      const result = await usage.summary();
      expect(result.status).toBe('invoiced');
    });

    it('returns status as "shadow" when response contains shadow status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { ...mockUsageSummary, status: 'shadow' },
        traceId: 'trace-3',
      });

      const result = await usage.summary();
      expect(result.status).toBe('shadow');
    });

    it('propagates errors from the HTTP client', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network failure')
      );

      await expect(usage.summary()).rejects.toThrow('Network failure');
    });
  });

  // ============================================
  // daily()
  // ============================================

  describe('daily', () => {
    it('sends GET /api/v1/usage/daily with required from and to params', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDailyUsage,
        traceId: 'trace-1',
      });

      await usage.daily({ from: '2026-04-01', to: '2026-04-07' });

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/usage/daily?from=2026-04-01&to=2026-04-07',
      });
    });

    it('includes meter query param when provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDailyUsage,
        traceId: 'trace-1',
      });

      await usage.daily({ from: '2026-04-01', to: '2026-04-07', meter: 'api_requests' });

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/usage/daily?from=2026-04-01&to=2026-04-07&meter=api_requests',
      });
    });

    it('includes groupBy query param when provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDailyUsage,
        traceId: 'trace-1',
      });

      await usage.daily({ from: '2026-04-01', to: '2026-04-07', groupBy: 'meter' });

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/usage/daily?from=2026-04-01&to=2026-04-07&groupBy=meter',
      });
    });

    it('includes both meter and groupBy when both provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDailyUsage,
        traceId: 'trace-1',
      });

      await usage.daily({
        from: '2026-04-01',
        to: '2026-04-30',
        meter: 'documents',
        groupBy: 'day',
      });

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/usage/daily?from=2026-04-01&to=2026-04-30&meter=documents&groupBy=day',
      });
    });

    it('throws ValidationError when from is missing', async () => {
      await expect(
        usage.daily({ from: '', to: '2026-04-07' })
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when to is missing', async () => {
      await expect(
        usage.daily({ from: '2026-04-01', to: '' })
      ).rejects.toThrow(ValidationError);
    });

    it('returns { data: DailyUsage[] } shape', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockDailyUsage,
        traceId: 'trace-1',
      });

      const result = await usage.daily({ from: '2026-04-01', to: '2026-04-02' });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].date).toBe('2026-04-01');
      expect(result.data[0].meter).toBe('api_requests');
      expect(result.data[0].quantity).toBe(42);
    });

    it('returns empty array when no daily data in range', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        traceId: 'trace-1',
      });

      const result = await usage.daily({ from: '2026-01-01', to: '2026-01-01' });
      expect(result.data).toHaveLength(0);
    });

    it('propagates errors from the HTTP client', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Timeout')
      );

      await expect(
        usage.daily({ from: '2026-04-01', to: '2026-04-07' })
      ).rejects.toThrow('Timeout');
    });
  });

  // ============================================
  // rateLimits()
  // ============================================

  describe('rateLimits', () => {
    it('sends GET /api/v1/usage/rate-limits', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockRateLimitStatus,
        traceId: 'trace-1',
      });

      await usage.rateLimits();

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/usage/rate-limits',
      });
    });

    it('returns RateLimitStatus shape with all fields', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockRateLimitStatus,
        traceId: 'trace-1',
      });

      const result = await usage.rateLimits();

      expect(result.requestsPerMinute).toBe(60);
      expect(result.remaining).toBe(45);
      expect(result.resetsAt).toBe('2026-04-01T12:01:00Z');
    });

    it('returns remaining=0 when rate limit is exhausted', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { ...mockRateLimitStatus, remaining: 0 },
        traceId: 'trace-2',
      });

      const result = await usage.rateLimits();
      expect(result.remaining).toBe(0);
    });

    it('propagates errors from the HTTP client', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Unauthorized')
      );

      await expect(usage.rateLimits()).rejects.toThrow('Unauthorized');
    });
  });
});
