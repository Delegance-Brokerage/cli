import { describe, it, expect, vi } from 'vitest';
import { AuthModule, DeviceLoginModule } from '../modules/auth';
import { pollUntilReady } from '../utils/poll';
import { RateLimitError, DeleganceError, OutcomeUnknownError } from '../types';
import { HttpClient } from '../utils/http';

function mockHttp(...responses: unknown[]) {
  const request = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) request.mockRejectedValueOnce(r);
    else request.mockResolvedValueOnce(r);
  }
  return { http: { request, uploadFile: vi.fn() } as unknown as HttpClient, request };
}

describe('DeviceLoginModule', () => {
  it('starts without a key and returns the code and URL', async () => {
    const { http, request } = mockHttp({ data: { loginId: 'l1', userCode: 'BCDF-GHJK', verificationUri: 'u', verificationUriComplete: 'u?code=BCDF-GHJK', expiresAt: 'e', interval: 5 } });
    const makeHttp = vi.fn(() => http);
    const r = await new DeviceLoginModule(makeHttp).start({ deviceSecretHash: 'h', deviceName: 'mbp' });
    expect(r.userCode).toBe('BCDF-GHJK');
    expect(makeHttp).toHaveBeenCalledWith('');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/auth/device', body: { deviceSecretHash: 'h', deviceName: 'mbp' } });
  });

  it('polls until ready', async () => {
    const { http } = mockHttp(
      { data: { status: 'pending' } },
      { data: { apiKey: 'dlg_x', keyPrefix: 'dlg_abcd1234', companyId: 'c1', scopes: ['read'], expiresAt: '2026-12-23T00:00:00Z' } },
    );
    const r = await new DeviceLoginModule(() => http).waitForKey('l1', 's', { intervalMs: 1, timeoutMs: 1000 });
    expect(r).toEqual({ status: 'ready', apiKey: 'dlg_x', keyPrefix: 'dlg_abcd1234', companyId: 'c1', scopes: ['read'], expiresAt: '2026-12-23T00:00:00Z' });
  });

  it('surfaces a denial instead of waiting', async () => {
    const denied = Object.assign(new DeleganceError('denied', 403), { reason: 'access_denied' });
    const { http } = mockHttp(denied);
    await expect(new DeviceLoginModule(() => http).waitForKey('l1', 's', { intervalMs: 1 })).rejects.toMatchObject({ reason: 'access_denied' });
  });
});

describe('pollUntilReady', () => {
  it('keeps polling through a 429 (signup and login both use it)', async () => {
    const poll = vi.fn()
      .mockRejectedValueOnce(new RateLimitError('slow down', 0))
      .mockResolvedValueOnce({ status: 'ready' });
    const r = await pollUntilReady(poll, { intervalMs: 1, timeoutMs: 5000 });
    expect(r).toEqual({ status: 'ready' });
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('keeps polling through a timeout or dropped connection (the poll is a status check)', async () => {
    const poll = vi.fn()
      .mockRejectedValueOnce(new OutcomeUnknownError('no response', 'POST', '/api/v1/auth/device/token', true))
      .mockRejectedValueOnce(new DeleganceError('bad gateway', 502))
      .mockResolvedValueOnce({ status: 'ready' });
    const r = await pollUntilReady(poll, { intervalMs: 1, timeoutMs: 5000 });
    expect(r).toEqual({ status: 'ready' });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('still surfaces a permanent answer or a switched-off feature', async () => {
    const off = Object.assign(new DeleganceError('off', 503), { reason: 'not_available' });
    await expect(pollUntilReady(vi.fn().mockRejectedValueOnce(off), { intervalMs: 1 })).rejects.toBe(off);
    const gone = Object.assign(new DeleganceError('expired', 410), { reason: 'expired' });
    await expect(pollUntilReady(vi.fn().mockRejectedValueOnce(gone), { intervalMs: 1 })).rejects.toBe(gone);
  });

  it('a real HttpClient poll survives one network blip', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { apiKey: 'dlg_x', keyPrefix: 'dlg_abcd1234', companyId: 'c1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const http = new HttpClient({ apiKey: '', baseUrl: 'https://example.test', retries: 0 });
      const r = await new DeviceLoginModule(() => http).waitForKey('l1', 's', { intervalMs: 1, timeoutMs: 5000 });
      expect(r).toMatchObject({ status: 'ready', apiKey: 'dlg_x' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns pending at the timeout', async () => {
    const r = await pollUntilReady(async () => ({ status: 'pending' as const }), { intervalMs: 1, timeoutMs: 5 });
    expect(r).toEqual({ status: 'pending' });
  });
});

describe('AuthModule', () => {
  it('reads key info and refreshes', async () => {
    const { http, request } = mockHttp({ data: { keyPrefix: 'dlg_abcd1234', expiresAt: 'e' } }, { data: { expiresAt: 'e2' } });
    const m = new AuthModule(http);
    expect((await m.keyInfo()).keyPrefix).toBe('dlg_abcd1234');
    expect(await m.refresh()).toEqual({ expiresAt: 'e2' });
    expect(request.mock.calls.map((c) => [c[0].method, c[0].path])).toEqual([
      ['GET', '/api/v1/auth/key'],
      ['POST', '/api/v1/auth/refresh'],
    ]);
  });
});
