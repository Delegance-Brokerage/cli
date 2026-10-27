import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpClient, DEFAULT_BASE_URL } from '../utils/http';
import {
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  DeleganceError,
  ForbiddenError,
  NotImplementedError,
} from '../types';

function makeConfig(overrides = {}) {
  return {
    apiKey: 'dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345',
    baseUrl: 'https://api.test.com',
    timeout: 5000,
    retries: 2,
    ...overrides,
  };
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HttpClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('request', () => {
    it('makes GET request with correct headers', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { data: 'ok' }));

      const http = new HttpClient(makeConfig());
      await http.request({ method: 'GET', path: '/api/test' });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.test.com/api/test');
      expect(opts.method).toBe('GET');
      expect(opts.headers.Authorization).toBe(
        'Bearer dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345'
      );
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers['User-Agent']).toBe('delegance-sdk/0.3.1');
    });

    it('sends JSON body on POST', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { success: true }));

      const http = new HttpClient(makeConfig());
      await http.request({
        method: 'POST',
        path: '/api/create',
        body: { name: 'test' },
      });

      const [, opts] = fetchSpy.mock.calls[0];
      expect(opts.body).toBe(JSON.stringify({ name: 'test' }));
    });

    it('returns parsed JSON response', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { success: true, data: [1, 2] }));

      const http = new HttpClient(makeConfig());
      const result = await http.request<{ success: boolean; data: number[] }>({
        method: 'GET',
        path: '/test',
      });

      expect(result).toEqual({ success: true, data: [1, 2] });
    });

    it('strips trailing slash from baseUrl', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, {}));

      const http = new HttpClient(makeConfig({ baseUrl: 'https://api.test.com/' }));
      await http.request({ method: 'GET', path: '/test' });

      expect(fetchSpy.mock.calls[0][0]).toBe('https://api.test.com/test');
    });

    it('merges custom headers', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, {}));

      const http = new HttpClient(makeConfig({ headers: { 'X-Custom': 'val' } }));
      await http.request({ method: 'GET', path: '/test', headers: { 'X-Extra': 'yes' } });

      const {headers} = fetchSpy.mock.calls[0][1];
      expect(headers['X-Custom']).toBe('val');
      expect(headers['X-Extra']).toBe('yes');
    });

    it('does not set Content-Type for FormData', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, {}));

      const http = new HttpClient(makeConfig());
      await http.request({
        method: 'POST',
        path: '/upload',
        body: new FormData(),
        isFormData: true,
      });

      const {headers} = fetchSpy.mock.calls[0][1];
      expect(headers['Content-Type']).toBeUndefined();
    });
  });

  describe('error mapping', () => {
    it('throws AuthenticationError on 401', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(401, { message: 'Bad key' }));

      const http = new HttpClient(makeConfig({ retries: 0 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(AuthenticationError);
    });

    it('throws ValidationError on 400', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(400, { message: 'Invalid', details: { field: 'name' } })
      );

      const http = new HttpClient(makeConfig({ retries: 0 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError on 404', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(404, { message: 'Not found' }));

      const http = new HttpClient(makeConfig({ retries: 0 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(NotFoundError);
    });

    it('throws RateLimitError on 429 with retryAfter', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(429, { message: 'Slow down', retryAfter: 30 })
      );

      const http = new HttpClient(makeConfig({ retries: 0 }));
      try {
        await http.request({ method: 'GET', path: '/test' });
        expect.fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as RateLimitError).retryAfter).toBe(30);
      }
    });

    it('throws DeleganceError on 500', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(500, { message: 'Server error' }));

      const http = new HttpClient(makeConfig({ retries: 0 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(DeleganceError);
    });

    it('surfaces the server code on a 403 company_mismatch, beside reason and body', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(403, {
        error: 'Forbidden',
        message: 'This API key cannot access that company',
        code: 'company_mismatch',
        traceId: 'trace-cm',
      }));

      const http = new HttpClient(makeConfig({ retries: 3 }));
      try {
        await http.request({ method: 'GET', path: '/api/v1/documents?companyId=other' });
        expect.fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ForbiddenError);
        const err = e as DeleganceError;
        expect(err.code).toBe('company_mismatch');
        expect(err.reason).toBeUndefined();
        expect(err.body?.code).toBe('company_mismatch');
        expect(err.traceId).toBe('trace-cm');
      }
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves code undefined when the body has none, and ignores a non-string code', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(429, { reason: 'quote_limit_reached', code: 42 }));

      const http = new HttpClient(makeConfig({ retries: 3 }));
      try {
        await http.request({ method: 'POST', path: '/test' });
        expect.fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(RateLimitError);
        expect((e as DeleganceError).code).toBeUndefined();
        expect((e as DeleganceError).reason).toBe('quote_limit_reached');
      }
      // A 429 is never retried.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('preserves traceId in errors', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(404, { message: 'Missing', traceId: 'trace-123' })
      );

      const http = new HttpClient(makeConfig({ retries: 0 }));
      try {
        await http.request({ method: 'GET', path: '/test' });
        expect.fail('should throw');
      } catch (e) {
        expect((e as DeleganceError).traceId).toBe('trace-123');
      }
    });
  });

  describe('retry logic', () => {
    it('does NOT retry a 503 whose reason is not_available (a switched-off feature), and keeps its message', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(503, { error: 'Service Unavailable', reason: 'not_available', message: 'This is not available over the API yet.' }));
      const http = new HttpClient(makeConfig({ retries: 2 }));
      await expect(http.request({ method: 'POST', path: '/api/v1/quotes/instant/session', body: {} })).rejects.toMatchObject({
        statusCode: 503,
        reason: 'not_available',
        message: 'This is not available over the API yet.',
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps the last informative error when a later retry returns a bodyless 5xx', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(502, { message: 'Upstream carrier timed out' }))
        .mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
      const http = new HttpClient(makeConfig({ retries: 1 }));
      await expect(http.request({ method: 'GET', path: '/x' })).rejects.toMatchObject({ message: 'Upstream carrier timed out' });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('retries on 500 errors', async () => {
      fetchSpy
        .mockResolvedValueOnce(jsonResponse(500, { message: 'error' }))
        .mockResolvedValueOnce(jsonResponse(200, { success: true }));

      const http = new HttpClient(makeConfig({ retries: 2 }));
      const result = await http.request<{ success: boolean }>({
        method: 'GET',
        path: '/test',
      });

      expect(result.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry on 401', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }));

      const http = new HttpClient(makeConfig({ retries: 3 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(AuthenticationError);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 400', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(400, { message: 'Bad input' }));

      const http = new HttpClient(makeConfig({ retries: 3 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(ValidationError);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 404', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(404, { message: 'Missing' }));

      const http = new HttpClient(makeConfig({ retries: 3 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(NotFoundError);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 403 and raises ForbiddenError', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(403, { message: 'Write scope required' }));

      const http = new HttpClient(makeConfig({ retries: 3 }));
      await expect(http.request({ method: 'POST', path: '/test' }))
        .rejects.toThrow(ForbiddenError);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 501 and raises NotImplementedError with the server message', async () => {
      fetchSpy.mockResolvedValue(
        jsonResponse(501, { error: 'Not Implemented', message: 'Quote submission is not currently available.' })
      );

      const http = new HttpClient(makeConfig({ retries: 3 }));
      const err = (await http.request({ method: 'POST', path: '/api/v1/quotes' }).catch((e) => e)) as NotImplementedError;

      expect(err).toBeInstanceOf(NotImplementedError);
      expect(err.statusCode).toBe(501);
      expect(err.message).toBe('Quote submission is not currently available.');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 409', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(409, { message: 'Conflict' }));

      const http = new HttpClient(makeConfig({ retries: 3 }));
      await expect(http.request({ method: 'POST', path: '/test' }))
        .rejects.toThrow(DeleganceError);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('retries on network errors', async () => {
      fetchSpy
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const http = new HttpClient(makeConfig({ retries: 2 }));
      const result = await http.request<{ ok: boolean }>({
        method: 'GET',
        path: '/test',
      });

      expect(result.ok).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(500, { message: 'down' }));

      const http = new HttpClient(makeConfig({ retries: 1 }));
      await expect(http.request({ method: 'GET', path: '/test' }))
        .rejects.toThrow(DeleganceError);

      // Initial attempt + 1 retry
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('uploadFile', () => {
    it('sends multipart form data', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(200, { success: true }));

      const http = new HttpClient(makeConfig());
      const file = Buffer.from('pdf content');
      await http.uploadFile('/api/upload', file, 'test.pdf', { companyId: 'c-1' });

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.test.com/api/upload');
      expect(opts.method).toBe('POST');
      // Should NOT set Content-Type (FormData sets it with boundary)
      expect(opts.headers['Content-Type']).toBeUndefined();
      expect(opts.body).toBeInstanceOf(FormData);
    });

    it('throws on error response', async () => {
      fetchSpy.mockResolvedValue(jsonResponse(400, { message: 'Bad file' }));

      const http = new HttpClient(makeConfig());
      await expect(
        http.uploadFile('/api/upload', Buffer.from('x'), 'test.pdf')
      ).rejects.toThrow(ValidationError);
    });
  });
});

describe('default base URL', () => {
  it('exports the live prod host as the default', () => {
    expect(DEFAULT_BASE_URL).toBe('https://portal.delegancebrokerage.com');
  });

  it('uses DEFAULT_BASE_URL when no baseUrl is configured', () => {
    const client = new HttpClient({ apiKey: 'dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345' });
    expect((client as never as { config: { baseUrl: string } }).config.baseUrl).toBe(DEFAULT_BASE_URL);
  });
});
