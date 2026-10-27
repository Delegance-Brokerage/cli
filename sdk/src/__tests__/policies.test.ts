import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoliciesModule, type Policy, type PolicyCoverage } from '../modules/policies';
import { HttpClient } from '../utils/http';
import { NotFoundError } from '../types';

function createMockHttp() {
  return {
    request: vi.fn(),
    uploadFile: vi.fn(),
  } as unknown as HttpClient;
}

const mockPolicy: Policy = {
  id: 'pol-uuid-1',
  name: 'General Liability',
  carrier: 'Hartford',
  policyNumber: 'GL-001-2026',
  policyType: 'GL',
  premium: 5000,
  deductible: 1000,
  aggregateLimit: 2000000,
  occurrenceLimit: 1000000,
  effectiveDate: '2026-01-01',
  expiryDate: '2027-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  isActive: true,
  daysUntilExpiry: 280,
  status: 'active',
};

const mockCoverages: PolicyCoverage[] = [
  {
    id: 'cov-1',
    coverageType: 'General Aggregate',
    limit: 2000000,
    deductible: 1000,
    description: 'General aggregate coverage',
  },
  {
    id: 'cov-2',
    coverageType: 'Each Occurrence',
    limit: 1000000,
    deductible: 1000,
    description: 'Per occurrence coverage',
  },
];

describe('PoliciesModule', () => {
  let http: ReturnType<typeof createMockHttp>;
  let policies: PoliciesModule;

  beforeEach(() => {
    http = createMockHttp();
    policies = new PoliciesModule(http as unknown as HttpClient);
  });

  describe('list', () => {
    it('calls GET /api/v1/policies with no params', async () => {
      const response = {
        success: true,
        policies: [mockPolicy],
        count: 1,
        traceId: 'trace-1',
      };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      const result = await policies.list();

      expect(result).toEqual(response);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/policies',
      });
    });

    it('passes active status filter', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.list({ status: 'active' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('status=active');
    });

    it('passes expired status filter', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.list({ status: 'expired' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('status=expired');
    });

    it('omits status param when "all" is specified', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.list({ status: 'all' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).not.toContain('status=');
    });

    it('passes expiringDays filter as "expiring" param', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.list({ expiringDays: 60 });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('expiring=60');
    });

    it('passes policyType filter as "type" param', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.list({ policyType: 'GL' });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('type=GL');
    });

    it('passes limit filter', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.list({ limit: 25 });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('limit=25');
    });

    it('combines multiple filters', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.list({ status: 'active', policyType: 'WC', limit: 10 });

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('status=active');
      expect(calledPath).toContain('type=WC');
      expect(calledPath).toContain('limit=10');
    });
  });

  describe('getExpiring', () => {
    it('calls list with expiringDays and active status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [{ ...mockPolicy, daysUntilExpiry: 15, status: 'expiring_soon' }],
        count: 1,
        traceId: 'trace-1',
      });

      const result = await policies.getExpiring(30);

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('expiring=30');
      expect(calledPath).toContain('status=active');
      expect(result.count).toBe(1);
    });

    it('defaults to 30 days', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policies: [],
        count: 0,
        traceId: 'trace-1',
      });

      await policies.getExpiring();

      const calledPath = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].path;
      expect(calledPath).toContain('expiring=30');
    });
  });

  describe('get', () => {
    it('calls GET /api/v1/policies/:id and returns policy with coverages', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policy: mockPolicy,
        coverages: mockCoverages,
        traceId: 'trace-1',
      });

      const result = await policies.get('pol-uuid-1');

      expect(result).not.toBeNull();
      expect(result!.policy).toEqual(mockPolicy);
      expect(result!.coverages).toEqual(mockCoverages);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/policies/pol-uuid-1',
      });
    });

    it('returns empty coverages array when none exist', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        policy: mockPolicy,
        coverages: undefined,
        traceId: 'trace-1',
      });

      const result = await policies.get('pol-uuid-1');

      expect(result!.coverages).toEqual([]);
    });

    it('returns null on NotFoundError', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('Policy not found')
      );

      const result = await policies.get('nonexistent-id');

      expect(result).toBeNull();
    });

    it('throws non-NotFoundError even if message contains 404', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Resource 404 Not found')
      );

      await expect(policies.get('nonexistent-id')).rejects.toThrow('Resource 404 Not found');
    });

    it('throws on non-404 errors', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Internal server error')
      );

      await expect(policies.get('pol-uuid-1')).rejects.toThrow('Internal server error');
    });

    it('throws on authentication errors', async () => {
      const authError = new Error('Unauthorized');
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(authError);

      await expect(policies.get('pol-uuid-1')).rejects.toThrow('Unauthorized');
    });
  });
});
