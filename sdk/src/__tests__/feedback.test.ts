import { describe, it, expect, vi } from 'vitest';
import { FeedbackModule } from '../modules/feedback';
import { DeleganceClient } from '../client';
import { HttpClient } from '../utils/http';

function mockHttp(response: unknown) {
  const request = vi.fn().mockResolvedValue(response);
  return { http: { request, uploadFile: vi.fn() } as unknown as HttpClient, request };
}

describe('FeedbackModule', () => {
  it('POSTs type, message and context to /api/v1/feedback and returns the id', async () => {
    const { http, request } = mockHttp({ success: true, data: { id: 'fb-1' } });
    const r = await new FeedbackModule(http).submit({
      type: 'bug',
      message: 'quote submit hung',
      context: { command: 'quote submit', exitCode: 1, traceId: 't-123456789' },
    });
    expect(r).toEqual({ id: 'fb-1' });
    expect(request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/feedback',
      body: { type: 'bug', message: 'quote submit hung', context: { command: 'quote submit', exitCode: 1, traceId: 't-123456789' } },
      headers: { 'Idempotency-Key': expect.stringMatching(/^[0-9a-f-]{36}$/) },
      idempotent: true,
    });
  });

  // bugbot #4979: the HTTP client retries network errors and 5xx inside ONE
  // request() call, with the same options object, so one key per submit makes
  // every retry of that submit the same report on the server.
  it('sends one fresh Idempotency-Key per submit, or the caller\'s own', async () => {
    const { http, request } = mockHttp({ data: { id: 'fb-1' } });
    const m = new FeedbackModule(http);
    await m.submit({ message: 'a' });
    await m.submit({ message: 'a' });
    await m.submit({ message: 'a' }, { idempotencyKey: 'my-key-123456' });
    const keys = request.mock.calls.map((c) => c[0].headers['Idempotency-Key']);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[2]).toBe('my-key-123456');
  });

  it('defaults the type to bug and omits an empty context', async () => {
    const { http, request } = mockHttp({ data: { id: 'fb-2' } });
    await new FeedbackModule(http).submit({ message: 'x' });
    expect(request.mock.calls[0][0].body).toEqual({ type: 'bug', message: 'x' });
  });

  it('refuses an empty or over-long message before any request', async () => {
    const { http, request } = mockHttp({ data: { id: 'x' } });
    const m = new FeedbackModule(http);
    await expect(m.submit({ message: '   ' })).rejects.toThrow(/message/);
    await expect(m.submit({ message: 'x'.repeat(501) })).rejects.toThrow(/500/);
    expect(request).not.toHaveBeenCalled();
  });

  it('is on the client as client.feedback', () => {
    const client = new DeleganceClient({ apiKey: 'dlg_abcd1234_sk_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345' });
    expect(client.feedback).toBeInstanceOf(FeedbackModule);
  });
});

// bugbot #4979 round 2: the route answers 503 report_id_pending when the row
// was written but its id could not be read back. The real HttpClient must
// retry that with the SAME Idempotency-Key, and the retry returns the id.
describe('FeedbackModule over the real HttpClient', () => {
  function jsonResponse(status: number, body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }
  function client() {
    const http = new HttpClient({ apiKey: 'dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345', baseUrl: 'https://api.test.com', retries: 2 });
    vi.spyOn(http as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);
    return new FeedbackModule(http);
  }
  const keyOf = (call: unknown[]) => new Headers((call[1] as RequestInit).headers).get('Idempotency-Key');

  it('retries a 503 report_id_pending once with the same Idempotency-Key and returns the id', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'Service Unavailable', reason: 'report_id_pending' }))
      .mockResolvedValueOnce(jsonResponse(201, { success: true, data: { id: 'row-uuid' } }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(client().submit({ message: 'quote hung' })).resolves.toEqual({ id: 'row-uuid' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(keyOf(fetchSpy.mock.calls[0])).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyOf(fetchSpy.mock.calls[1])).toBe(keyOf(fetchSpy.mock.calls[0]));
    vi.unstubAllGlobals();
  });

  it('control: a 503 not_available (feature off) is not retried, which is why the route must not use it here', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'Service Unavailable', reason: 'not_available' }));
    vi.stubGlobal('fetch', fetchSpy);
    await expect(client().submit({ message: 'quote hung' })).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
