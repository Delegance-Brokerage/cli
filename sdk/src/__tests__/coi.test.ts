import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COIModule } from '../modules/coi';
import type { HttpClient } from '../utils/http';

function mockHttp(): HttpClient {
  return { request: vi.fn(), uploadFile: vi.fn() } as unknown as HttpClient;
}

describe('COIModule', () => {
  let http: HttpClient;
  let coi: COIModule;

  beforeEach(() => {
    http = mockHttp();
    coi = new COIModule(http);
  });

  describe('generate', () => {
    it('calls POST /api/v1/coi with request body', async () => {
      const response = {
        success: true,
        coiId: 'coi-1',
        downloadUrl: 'https://s3.amazonaws.com/bucket/coi.pdf',
        expiresAt: '2026-02-01',
        policiesIncluded: [{ id: 'p-1', carrier: 'Hartford', policyType: 'GL' }],
        traceId: 't-1',
      };
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      const result = await coi.generate({
        policyIds: ['p-1'],
        certificateHolder: {
          name: 'ABC Property',
          address: '123 Main St',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
        },
        certificateType: 'additional_insured',
        description: 'Tenant at 456 Oak',
        specialProvisions: ['Waiver of subrogation'],
      });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/coi',
        body: {
          policyIds: ['p-1'],
          certificateHolder: {
            name: 'ABC Property',
            address: '123 Main St',
            city: 'Austin',
            state: 'TX',
            zip: '78701',
          },
          certificateType: 'additional_insured',
          description: 'Tenant at 456 Oak',
          specialProvisions: ['Waiver of subrogation'],
        },
      });
      expect(result.coiId).toBe('coi-1');
      expect(result.downloadUrl).toContain('s3.amazonaws.com');
    });

    it('works with minimal fields', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        coiId: 'coi-2',
        downloadUrl: 'https://example.com/coi.pdf',
        expiresAt: '2026-03-01',
        policiesIncluded: [],
        traceId: 't-2',
      });

      await coi.generate({
        policyIds: ['p-1'],
        certificateHolder: { name: 'Simple Corp' },
      });

      const body = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0].body;
      expect(body.certificateHolder.name).toBe('Simple Corp');
      expect(body.certificateType).toBeUndefined();
    });
  });

  describe('list', () => {
    it('calls GET /api/v1/coi with default limit', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        cois: [{ id: 'coi-1', certificateHolder: 'ABC', certificateType: 'additional_insured', policyIds: ['p-1'], createdAt: '2026-01-01' }],
        count: 1,
        traceId: 't-1',
      });

      const result = await coi.list();
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/coi?limit=50',
      });
      expect(result.cois).toHaveLength(1);
    });

    it('passes custom limit', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        cois: [],
        count: 0,
        traceId: 't-1',
      });

      await coi.list(100);
      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/coi?limit=100',
      });
    });
  });
});
