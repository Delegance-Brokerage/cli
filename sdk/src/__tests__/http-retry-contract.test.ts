/**
 * H2 client contract: writes go out once unless marked idempotent and keyed,
 * reads retry 429/503 honouring Retry-After under a deadline, and every
 * request names the API version and the client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpClient, API_VERSION, SDK_VERSION, parseRetryAfterMs, mayRetry } from '../utils/http';
import { DeleganceError, OutcomeUnknownError, RateLimitError } from '../types';

const KEY = 'dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345';

function jsonResponse(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function makeClient(overrides: Record<string, unknown> = {}) {
  const http = new HttpClient({ apiKey: KEY, baseUrl: 'https://api.test.com', timeout: 5000, retries: 3, ...overrides });
  const delay = vi
    .spyOn(http as unknown as { delay: (ms: number) => Promise<void> }, 'delay')
    .mockResolvedValue(undefined);
  return { http, delay };
}

describe('HttpClient retry contract', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('unkeyed writes go out once', () => {
    it('does not retry an unkeyed POST on 503', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, { message: 'down' }, { 'Retry-After': '1' }));
      const { http } = makeClient();
      await expect(http.request({ method: 'POST', path: '/api/v1/coi', body: { a: 1 } })).rejects.toMatchObject({ statusCode: 503 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry an unkeyed POST on 500', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(500, { message: 'boom' }));
      const { http } = makeClient();
      await expect(http.request({ method: 'POST', path: '/api/v1/quotes', body: {} })).rejects.toThrow(DeleganceError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('turns a network failure on a POST into OutcomeUnknownError and sends it once', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
      const { http } = makeClient();
      const err = (await http.request({ method: 'POST', path: '/api/v1/coi', body: {} }).catch((e) => e)) as OutcomeUnknownError;
      expect(err).toBeInstanceOf(OutcomeUnknownError);
      expect(err).toBeInstanceOf(DeleganceError);
      expect(err.outcome).toBe('unknown');
      expect(err.statusCode).toBe(0);
      expect(err.timedOut).toBe(false);
      expect(err.message).toMatch(/check whether it went through/i);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('turns its own timeout on a POST into OutcomeUnknownError with timedOut true', async () => {
      fetchSpy.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const { http } = makeClient({ timeout: 20 });
      const err = (await http.request({ method: 'POST', path: '/api/v1/claims', body: {} }).catch((e) => e)) as OutcomeUnknownError;
      expect(err).toBeInstanceOf(OutcomeUnknownError);
      expect(err.timedOut).toBe(true);
      expect(err.message).toContain('POST /api/v1/claims');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('a key alone does not make a write retryable', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, { message: 'down' }));
      const { http } = makeClient();
      await expect(http.request({
        method: 'POST', path: '/api/v1/claims', body: {}, headers: { 'Idempotency-Key': 'k-123456789' },
      })).rejects.toMatchObject({ statusCode: 503 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('idempotent without a key is still sent once', async () => {
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
      const { http } = makeClient();
      await expect(http.request({ method: 'PATCH', path: '/x', body: {}, idempotent: true })).rejects.toBeInstanceOf(OutcomeUnknownError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('sends an upload once', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(502, { message: 'bad gateway' }));
      const { http } = makeClient();
      await expect(http.uploadFile('/api/v1/documents', Buffer.from('x'), 'a.pdf')).rejects.toMatchObject({ statusCode: 502 });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyed idempotent writes retry with the same key', () => {
    it('retries a 503 and reuses the Idempotency-Key', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(503, { message: 'busy' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const { http } = makeClient();
      const out = await http.request<{ ok: boolean }>({
        method: 'POST', path: '/x', body: {}, headers: { 'Idempotency-Key': 'k-abcdefgh' }, idempotent: true,
      });
      expect(out.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const keys = fetchSpy.mock.calls.map((c) => new Headers((c[1] as RequestInit).headers).get('Idempotency-Key'));
      expect(keys).toEqual(['k-abcdefgh', 'k-abcdefgh']);
    });
  });

  describe('reads honour Retry-After', () => {
    it('retries a GET on 429 and waits at least Retry-After seconds', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(429, { message: 'slow down' }, { 'Retry-After': '3' }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const { http, delay } = makeClient();
      const out = await http.request<{ ok: boolean }>({ method: 'GET', path: '/x' });
      expect(out.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(delay).toHaveBeenCalledTimes(1);
      const waited = delay.mock.calls[0][0] as number;
      expect(waited).toBeGreaterThanOrEqual(3000);
      expect(waited).toBeLessThan(4000);
    });

    it('reads an HTTP-date Retry-After on a 503', async () => {
      const at = new Date(Date.now() + 10_000).toUTCString();
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(503, { message: 'maintenance' }, { 'Retry-After': at }))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
      const { http, delay } = makeClient();
      await http.request({ method: 'GET', path: '/x' });
      const waited = delay.mock.calls[0][0] as number;
      expect(waited).toBeGreaterThan(8000);
      expect(waited).toBeLessThan(12_000);
    });

    it('stops when Retry-After passes the deadline and surfaces the 429 with retryAfter', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(429, { message: 'budget' }, { 'Retry-After': '3600' }));
      const { http, delay } = makeClient({ retryDeadlineMs: 60_000 });
      const err = (await http.request({ method: 'GET', path: '/x' }).catch((e) => e)) as RateLimitError;
      expect(err).toBeInstanceOf(RateLimitError);
      expect(err.retryAfter).toBe(3600);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    });

    it('still never retries a 503 not_available', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, { reason: 'not_available', message: 'off' }, { 'Retry-After': '1' }));
      const { http } = makeClient();
      await expect(http.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({ reason: 'not_available' });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('jitters the exponential backoff between half and all of the base', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(500, {}))
        .mockResolvedValueOnce(jsonResponse(500, {}))
        .mockResolvedValueOnce(jsonResponse(200, {}));
      const { http, delay } = makeClient();
      await http.request({ method: 'GET', path: '/x' });
      const [first, second] = delay.mock.calls.map((c) => c[0] as number);
      expect(first).toBeGreaterThanOrEqual(1000);
      expect(first).toBeLessThanOrEqual(2000);
      expect(second).toBeGreaterThanOrEqual(2000);
      expect(second).toBeLessThanOrEqual(4000);
    });
  });

  describe('version and client headers', () => {
    it('sends Delegance-Version and X-Delegance-Client on every request and upload', async () => {
      fetchSpy.mockImplementation(async () => jsonResponse(200, {}));
      const { http } = makeClient();
      await http.request({ method: 'GET', path: '/a' });
      await http.request({ method: 'POST', path: '/b', body: {} });
      await http.uploadFile('/c', Buffer.from('x'), 'c.pdf');
      for (const call of fetchSpy.mock.calls) {
        const h = new Headers((call[1] as RequestInit).headers);
        expect(h.get('Delegance-Version')).toBe('2026-10-01');
        expect(h.get('X-Delegance-Client')).toBe(`sdk/${SDK_VERSION}`);
      }
      expect(API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('reports the package.json version in X-Delegance-Client', () => {
      const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
      expect(`sdk/${SDK_VERSION}`).toBe(`sdk/${pkg.version}`);
    });

    it('lets a wrapping client (the CLI) name itself', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, {}));
      const { http } = makeClient({ headers: { 'X-Delegance-Client': 'cli/0.3.1' } });
      await http.request({ method: 'GET', path: '/a' });
      const h = new Headers((fetchSpy.mock.calls[0][1] as RequestInit).headers);
      expect(h.get('X-Delegance-Client')).toBe('cli/0.3.1');
      expect(h.get('Delegance-Version')).toBe('2026-10-01');
    });
  });
});

describe('parseRetryAfterMs', () => {
  it('reads seconds, HTTP-dates, and rejects junk', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    expect(parseRetryAfterMs('30', now)).toBe(30_000);
    expect(parseRetryAfterMs('Tue, 13 Oct 2026 12:00:05 GMT', now)).toBe(5000);
    expect(parseRetryAfterMs('Tue, 13 Oct 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfterMs('soon', now)).toBeUndefined();
    expect(parseRetryAfterMs('', now)).toBeUndefined();
    expect(parseRetryAfterMs(null, now)).toBeUndefined();
  });
});

describe('mayRetry', () => {
  it('allows reads, and writes only when idempotent and keyed', () => {
    expect(mayRetry('GET', undefined, {})).toBe(true);
    expect(mayRetry('POST', undefined, { 'Idempotency-Key': 'k' })).toBe(false);
    expect(mayRetry('POST', true, {})).toBe(false);
    expect(mayRetry('POST', true, { 'idempotency-key': '  ' })).toBe(false);
    expect(mayRetry('DELETE', true, { 'idempotency-key': 'k' })).toBe(true);
    expect(mayRetry('PUT', false, { 'Idempotency-Key': 'k' })).toBe(false);
  });
});
