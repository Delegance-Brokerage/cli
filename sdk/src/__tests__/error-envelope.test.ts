/**
 * H2b: the SDK reads the v1 error envelope (`code`, `retryable`) onto the
 * typed error, and a keyed request that meets 409 idempotency_in_progress
 * waits out Retry-After and sends once more, never twice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpClient, isIdempotencyInProgress } from '../utils/http';
import { DeleganceError, OutcomeUnknownError, V1_ERROR_CODES } from '../types';
import * as sdk from '../index';

const KEY = 'dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345';
const IDEM = { 'Idempotency-Key': 'idem-sdk-test-0001' };

function jsonResponse(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

const inProgress = (retryAfter: string | null = '2') =>
  jsonResponse(
    409,
    { error: 'Conflict', reason: 'in_progress', message: 'The same request is still running.', code: 'idempotency_in_progress', retryable: true },
    retryAfter === null ? {} : { 'Retry-After': retryAfter },
  );

function makeClient(overrides: Record<string, unknown> = {}) {
  const http = new HttpClient({ apiKey: KEY, baseUrl: 'https://api.test.com', timeout: 5000, retries: 3, ...overrides });
  const delay = vi.spyOn(http as unknown as { delay: (ms: number) => Promise<void> }, 'delay').mockResolvedValue(undefined);
  return { http, delay };
}

describe('v1 error envelope', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('puts code and retryable on the typed error', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(403, { error: 'Forbidden', reason: 'claims_scope_required', code: 'forbidden', retryable: false }));
    const { http } = makeClient();
    const err = (await http.request({ method: 'GET', path: '/api/v1/claims' }).catch((e) => e)) as DeleganceError;
    expect(err).toBeInstanceOf(DeleganceError);
    expect(err.code).toBe('forbidden');
    expect(err.retryable).toBe(false);
    expect(err.reason).toBe('claims_scope_required');
  });

  it('leaves retryable undefined against an older server', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(404, { error: 'Not Found' }));
    const { http } = makeClient();
    const err = (await http.request({ method: 'GET', path: '/api/v1/claims/x' }).catch((e) => e)) as DeleganceError;
    expect(err.retryable).toBeUndefined();
    expect(err.code).toBeUndefined();
  });

  it('ignores a non-boolean retryable', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(400, { error: 'Bad Request', retryable: 'yes' }));
    const { http } = makeClient();
    const err = (await http.request({ method: 'GET', path: '/api/v1/x' }).catch((e) => e)) as DeleganceError;
    expect(err.retryable).toBeUndefined();
  });

  it('exports the code list from the package entry', () => {
    expect(sdk.V1_ERROR_CODES).toBe(V1_ERROR_CODES);
  });

  it('matches the V1ErrorCode enum in the contract', () => {
    const yaml = readFileSync(join(__dirname, '..', '..', 'contract', 'openapi.yaml'), 'utf8');
    const block = yaml.split('\n    V1ErrorCode:')[1]?.split('\n    V1Error:')[0] ?? '';
    const codes = [...block.matchAll(/^\s+- ([a-z_]+)\s*$/gm)].map((m) => m[1]);
    expect(codes).toEqual([...V1_ERROR_CODES]);
  });
});

describe('409 idempotency_in_progress', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a keyed POST waits Retry-After and sends once more, then returns the replay', async () => {
    fetchSpy.mockResolvedValueOnce(inProgress('2')).mockResolvedValueOnce(jsonResponse(200, { success: true, data: { id: 'b1' } }));
    const { http, delay } = makeClient();
    const res = await http.request<{ data: { id: string } }>({ method: 'POST', path: '/api/v1/claims', body: { a: 1 }, headers: IDEM });
    expect(res.data.id).toBe('b1');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    const waited = delay.mock.calls[0][0] as number;
    expect(waited).toBeGreaterThanOrEqual(2000);
    expect(waited).toBeLessThan(3100);
    // The same key goes out both times.
    const keys = fetchSpy.mock.calls.map((c) => (c[1] as RequestInit).headers as Record<string, string>).map((h) => h['Idempotency-Key']);
    expect(keys).toEqual(['idem-sdk-test-0001', 'idem-sdk-test-0001']);
  });

  it('waits only once: a second in-progress answer is thrown', async () => {
    fetchSpy.mockImplementation(async () => inProgress('1'));
    const { http, delay } = makeClient();
    const err = (await http.request({ method: 'POST', path: '/api/v1/claims', body: {}, headers: IDEM }).catch((e) => e)) as DeleganceError;
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('idempotency_in_progress');
    expect(err.retryable).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
  });

  it('waits even when retries is 0, because the server has not run this copy', async () => {
    fetchSpy.mockResolvedValueOnce(inProgress('1')).mockResolvedValueOnce(jsonResponse(201, { success: true }));
    const { http } = makeClient({ retries: 0 });
    await expect(http.request({ method: 'POST', path: '/api/v1/claims', body: {}, headers: IDEM })).resolves.toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('recognises an older server that sends only reason in_progress', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Conflict', reason: 'in_progress' }, { 'Retry-After': '1' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const { http } = makeClient();
    await expect(http.request({ method: 'POST', path: '/api/v1/claims', body: {}, headers: IDEM })).resolves.toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not resend a request with no Idempotency-Key', async () => {
    fetchSpy.mockResolvedValue(inProgress('1'));
    const { http, delay } = makeClient();
    await expect(http.request({ method: 'POST', path: '/api/v1/claims', body: {} })).rejects.toMatchObject({ statusCode: 409 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not resend without a Retry-After', async () => {
    fetchSpy.mockResolvedValue(inProgress(null));
    const { http } = makeClient();
    await expect(http.request({ method: 'POST', path: '/api/v1/claims', body: {}, headers: IDEM })).rejects.toMatchObject({ statusCode: 409 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not resend when the wait would pass retryDeadlineMs', async () => {
    fetchSpy.mockResolvedValue(inProgress('120'));
    const { http, delay } = makeClient({ retryDeadlineMs: 5000 });
    await expect(http.request({ method: 'POST', path: '/api/v1/claims', body: {}, headers: IDEM })).rejects.toMatchObject({ statusCode: 409 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not treat a plain 409 conflict as in progress', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(409, { error: 'Conflict', reason: 'not_bindable', code: 'conflict' }, { 'Retry-After': '1' }));
    const { http } = makeClient();
    await expect(http.request({ method: 'POST', path: '/api/v1/x', body: {}, headers: IDEM })).rejects.toMatchObject({ statusCode: 409 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a timeout on the resend is still OutcomeUnknownError', async () => {
    fetchSpy
      .mockResolvedValueOnce(inProgress('1'))
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
    const { http } = makeClient({ timeout: 20 });
    const err = await http.request({ method: 'POST', path: '/api/v1/claims', body: {}, headers: IDEM }).catch((e) => e);
    expect(err).toBeInstanceOf(OutcomeUnknownError);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('isIdempotencyInProgress needs a 409', () => {
    const e = new DeleganceError('x', 503);
    e.code = 'idempotency_in_progress';
    expect(isIdempotencyInProgress(e)).toBe(false);
    const f = new DeleganceError('x', 409);
    f.code = 'idempotency_in_progress';
    expect(isIdempotencyInProgress(f)).toBe(true);
  });
});
