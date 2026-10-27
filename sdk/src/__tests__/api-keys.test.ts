import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiKeysModule } from '../modules/api-keys';
import { ValidationError, NotFoundError } from '../types';
import type { HttpClient } from '../utils/http';

function createMockHttp(): HttpClient {
  return { request: vi.fn(), uploadFile: vi.fn() } as unknown as HttpClient;
}

const mockApiKey = {
  id: 'key-1',
  name: 'Test Key',
  prefix: 'dlg_testpr',
  scopes: ['read'],
  isActive: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const mockCreatedApiKey = {
  ...mockApiKey,
  key: 'dlg_testpr_sk_abcdefghijklmnopqrstuvwxyz123456',
};

const mockRotateResult = {
  newKey: mockCreatedApiKey,
  oldKeyValidUntil: '2026-01-02T00:00:00Z',
  rotationId: 'rot-1',
  status: 'rotating' as const,
};

describe('ApiKeysModule', () => {
  let http: HttpClient;
  let apiKeys: ApiKeysModule;

  beforeEach(() => {
    http = createMockHttp();
    apiKeys = new ApiKeysModule(http);
  });

  describe('create', () => {
    it('sends POST /api/v1/api-keys with name, scopes, and expiresInDays', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockCreatedApiKey,
        traceId: 'trace-1',
      });

      const result = await apiKeys.create({
        name: 'Test Key',
        scopes: ['read'],
        expiresInDays: 30,
      });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/api-keys',
        body: { name: 'Test Key', scopes: ['read'], expiresInDays: 30 },
      });
      expect(result.key).toBe(mockCreatedApiKey.key);
      expect(result.id).toBe('key-1');
    });

    it('sends POST /api/v1/api-keys without optional fields', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockCreatedApiKey,
        traceId: 'trace-1',
      });

      await apiKeys.create({ name: 'Minimal Key', scopes: ['read'] });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/api-keys',
        body: { name: 'Minimal Key', scopes: ['read'] },
      });
    });

    it('passes Idempotency-Key header when provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockCreatedApiKey,
        traceId: 'trace-1',
      });

      await apiKeys.create(
        { name: 'Test Key', scopes: ['read'] },
        { idempotencyKey: 'idem-abc-123' }
      );

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/api-keys',
        body: { name: 'Test Key', scopes: ['read'] },
        headers: { 'Idempotency-Key': 'idem-abc-123' },
      });
    });

    it('does not pass Idempotency-Key header when not provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockCreatedApiKey,
        traceId: 'trace-1',
      });

      await apiKeys.create({ name: 'Test Key', scopes: ['read'] });

      const callArgs = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.headers).toBeUndefined();
    });

    it('throws ValidationError when name is empty string', async () => {
      await expect(
        apiKeys.create({ name: '', scopes: ['read'] })
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when name is whitespace only', async () => {
      await expect(
        apiKeys.create({ name: '   ', scopes: ['read'] })
      ).rejects.toThrow(ValidationError);
    });

    it('returns the full CreatedApiKey including key field', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: {
          ...mockCreatedApiKey,
          expiresAt: '2026-04-01T00:00:00Z',
        },
        traceId: 'trace-1',
      });

      const result = await apiKeys.create({
        name: 'Expiring Key',
        scopes: ['read', 'write'],
        expiresInDays: 90,
      });

      expect(result.expiresAt).toBe('2026-04-01T00:00:00Z');
      expect(result.scopes).toContain('read');
    });
  });

  describe('list', () => {
    it('sends GET /api/v1/api-keys without params when no options given', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockApiKey],
        pagination: { hasMore: false },
        traceId: 'trace-1',
      });

      const result = await apiKeys.list();

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/api-keys',
      });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('key-1');
    });

    it('sends limit query param when provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { hasMore: false },
        traceId: 'trace-1',
      });

      await apiKeys.list({ limit: 20 });

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/api-keys?limit=20',
      });
    });

    it('sends cursor query param when provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { hasMore: false },
        traceId: 'trace-1',
      });

      await apiKeys.list({ cursor: 'cursor-xyz' });

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/api-keys?cursor=cursor-xyz',
      });
    });

    it('sends both limit and cursor when both provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [],
        pagination: { hasMore: true, nextCursor: 'next-xyz' },
        traceId: 'trace-1',
      });

      await apiKeys.list({ limit: 10, cursor: 'cursor-abc' });

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/api-keys?limit=10&cursor=cursor-abc',
      });
    });

    it('returns pagination object from response', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: [mockApiKey],
        pagination: { hasMore: true, nextCursor: 'next-123', cursor: 'cur-1' },
        traceId: 'trace-1',
      });

      const result = await apiKeys.list({ limit: 1 });

      expect(result.pagination.hasMore).toBe(true);
      expect(result.pagination.nextCursor).toBe('next-123');
    });
  });

  describe('revoke', () => {
    it('sends DELETE /api/v1/api-keys/:id', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { message: 'API key revoked' },
        traceId: 'trace-1',
      });

      await apiKeys.revoke('key-1');

      expect(http.request).toHaveBeenCalledWith({
        method: 'DELETE',
        path: '/api/v1/api-keys/key-1',
      });
    });

    it('returns void on success', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: { message: 'API key revoked' },
        traceId: 'trace-1',
      });

      const result = await apiKeys.revoke('key-999');
      expect(result).toBeUndefined();
    });

    it('throws NotFoundError for unknown key', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(
        new NotFoundError('API key not found')
      );

      await expect(apiKeys.revoke('nonexistent-key')).rejects.toThrow(NotFoundError);
    });

    it('propagates other errors unchanged', async () => {
      const serverError = new Error('Internal server error');
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(serverError);

      await expect(apiKeys.revoke('key-1')).rejects.toThrow('Internal server error');
    });
  });

  describe('rotate', () => {
    it('sends POST /api/v1/api-keys/:id/rotate with gracePeriodHours', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockRotateResult,
        traceId: 'trace-1',
      });

      const result = await apiKeys.rotate('key-1', { gracePeriodHours: 24 });

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/api-keys/key-1/rotate',
        body: { gracePeriodHours: 24 },
      });
      expect(result.status).toBe('rotating');
      expect(result.newKey.key).toBe(mockCreatedApiKey.key);
    });

    it('passes Idempotency-Key header when provided', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockRotateResult,
        traceId: 'trace-1',
      });

      await apiKeys.rotate(
        'key-1',
        { gracePeriodHours: 12 },
        { idempotencyKey: 'rot-idem-456' }
      );

      expect(http.request).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/api-keys/key-1/rotate',
        body: { gracePeriodHours: 12 },
        headers: { 'Idempotency-Key': 'rot-idem-456' },
      });
    });

    it('does not pass Idempotency-Key header when idempotency omitted', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockRotateResult,
        traceId: 'trace-1',
      });

      await apiKeys.rotate('key-1', { gracePeriodHours: 0 });

      const callArgs = (http.request as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.headers).toBeUndefined();
    });

    it('returns RotateResult with rotationId and oldKeyValidUntil', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: mockRotateResult,
        traceId: 'trace-1',
      });

      const result = await apiKeys.rotate('key-1', { gracePeriodHours: 48 });

      expect(result.rotationId).toBe('rot-1');
      expect(result.oldKeyValidUntil).toBe('2026-01-02T00:00:00Z');
    });
  });

  describe('rotate without a server route', () => {
    it('turns the 404 into NotImplementedError that names the workaround', async () => {
      const { NotFoundError, NotImplementedError } = await import('../types');
      const request = vi.fn().mockRejectedValue(new NotFoundError('Not Found', 't'));
      const mod = new ApiKeysModule({ request, uploadFile: vi.fn() } as unknown as HttpClient);
      const err = await mod.rotate('key-1', { gracePeriodHours: 24 }).catch((e) => e);
      expect(err).toBeInstanceOf(NotImplementedError);
      expect(err.message).toMatch(/apiKeys\.create\(\)/);
    });
  });
});
