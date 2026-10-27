import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { InstantQuotesModule } from '../modules/instant-quotes';
import { PaymentsModule } from '../modules/payments';
import { BondsModule } from '../modules/bonds';
import { ClaimsModule } from '../modules/claims';
import { SignupModule, newDeviceSecret } from '../modules/signup';
import { TermsModule } from '../modules/terms';
import { HttpClient } from '../utils/http';
import { DeleganceError } from '../types';

function mockHttp(response: unknown) {
  const request = vi.fn().mockResolvedValue(response);
  return { http: { request, uploadFile: vi.fn() } as unknown as HttpClient, request };
}

describe('newDeviceSecret', () => {
  it('returns 64 hex chars and its SHA-256', () => {
    const { secret, hash } = newDeviceSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(createHash('sha256').update(secret).digest('hex'));
    expect(newDeviceSecret().secret).not.toBe(secret);
  });
});

describe('SignupModule', () => {
  it('creates the account unauthenticated with an Idempotency-Key', async () => {
    const { http, request } = mockHttp({ company: { id: 'co1' }, bootstrapKey: 'dlg_boot' });
    const keys: string[] = [];
    const signup = new SignupModule((k) => { keys.push(k); return http; });
    const r = await signup.createAccount({ name: 'Acme', contactEmail: 'a@acme.com', industry: 'bakery', companySize: '1-10' });
    expect(r).toEqual({ companyId: 'co1', bootstrapKey: 'dlg_boot' });
    expect(keys).toEqual(['']);
    expect(request.mock.calls[0][0].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('passes a server warning through (the account exists but the address was not saved)', async () => {
    const { http } = mockHttp({ company: { id: 'co1' }, bootstrapKey: 'dlg_boot', warnings: ['address_not_saved'] });
    const r = await new SignupModule(() => http).createAccount({ name: 'A', contactEmail: 'a@a.com', industry: 'x', companySize: '1' });
    expect(r.warnings).toEqual(['address_not_saved']);
  });

  it('refuses a replayed create whose key was already shown', async () => {
    const { http } = mockHttp({ company: { id: 'co1' }, bootstrapKey: null });
    await expect(new SignupModule(() => http).createAccount({ name: 'A', contactEmail: 'a@a.com', industry: 'x', companySize: '1-10' })).rejects.toThrow(/shown only once/);
  });

  it('enrolls and requests verification WITH the bootstrap key', async () => {
    const { http, request } = mockHttp({ data: { enrollmentId: 'e1', expiresAt: 'x' } });
    const keys: string[] = [];
    const signup = new SignupModule((k) => { keys.push(k); return http; });
    await signup.enroll('dlg_boot', { deviceSecretHash: 'h', firstName: 'A', lastName: 'B', termsAccepted: true, termsVersion: '2026-09-24' });
    await signup.requestVerification('dlg_boot');
    expect(keys).toEqual(['dlg_boot', 'dlg_boot']);
    expect(request.mock.calls.map((c) => c[0].path)).toEqual(['/api/v1/onboarding/cli-enroll', '/api/v1/onboarding/verification']);
    // The Terms acceptance rides the enrollment body; the server refuses without it.
    expect(request.mock.calls[0][0].body).toMatchObject({ termsAccepted: true, termsVersion: '2026-09-24' });
  });

  it('reads the current Terms with no key', async () => {
    const terms = { version: '2026-09-24', termsUrl: 't', privacyUrl: 'p', slaUrl: 's', summaries: ['x'], brokerReview: { email: 'e', command: 'c' } };
    const { http, request } = mockHttp({ data: terms });
    const keys: string[] = [];
    expect(await new SignupModule((k) => { keys.push(k); return http; }).getTerms()).toEqual(terms);
    expect(keys).toEqual(['']);
    expect(request.mock.calls[0][0]).toMatchObject({ method: 'GET', path: '/api/v1/legal/terms' });
  });

  it('exchange sends the plaintext secret with no key and maps pending vs ready', async () => {
    const pending = mockHttp({ data: { status: 'pending' } });
    const keys: string[] = [];
    expect(await new SignupModule((k) => { keys.push(k); return pending.http; }).exchange('e1', 's')).toEqual({ status: 'pending' });
    expect(keys).toEqual(['']);
    expect(pending.request.mock.calls[0][0].body).toEqual({ enrollmentId: 'e1', deviceSecret: 's' });
    const ready = mockHttp({ data: { apiKey: 'dlg_x', keyPrefix: 'dlg_p', companyId: 'co1' } });
    expect(await new SignupModule(() => ready.http).exchange('e1', 's')).toEqual({ status: 'ready', apiKey: 'dlg_x', keyPrefix: 'dlg_p', companyId: 'co1' });
  });

  it('exchange throws on an unexpected response instead of reading it as pending', async () => {
    const odd = mockHttp({ data: {} });
    await expect(new SignupModule(() => odd.http).exchange('e1', 's')).rejects.toThrow(/Unexpected response/);
  });

  it('waitForKey stops at the deadline with pending', async () => {
    const { http, request } = mockHttp({ data: { status: 'pending' } });
    const r = await new SignupModule(() => http).waitForKey('e1', 's', { timeoutMs: 0, intervalMs: 1 });
    expect(r).toEqual({ status: 'pending' });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('InstantQuotesModule', () => {
  it('start POSTs coverages', async () => {
    const { http, request } = mockHttp({ data: { submissionId: 's1' } });
    expect((await new InstantQuotesModule(http).start(['general_liability'])).submissionId).toBe('s1');
    expect(request).toHaveBeenCalledWith({ method: 'POST', path: '/api/v1/quotes/instant/session', body: { coverages: ['general_liability'] } });
  });

  it('submit and bind send an Idempotency-Key, honoring a caller key', async () => {
    const { http, request } = mockHttp({ data: {} });
    const q = new InstantQuotesModule(http);
    await q.submit({ submissionId: 's1', sessionVersion: 'v', answers: {} }, { idempotencyKey: 'mine-0001' });
    await q.bind('s1', 'opp-1');
    expect(request.mock.calls[0][0].headers).toEqual({ 'Idempotency-Key': 'mine-0001' });
    expect(request.mock.calls[1][0]).toMatchObject({ path: '/api/v1/quotes/instant/s1/bind', body: { opportunityId: 'opp-1' } });
    expect(request.mock.calls[1][0].headers['Idempotency-Key']).toBeTruthy();
  });

  it('waitForQuotes returns once every carrier resolved', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ data: { allCarriersResolved: false } })
      .mockResolvedValueOnce({ data: { allCarriersResolved: true } });
    const q = new InstantQuotesModule({ request } as unknown as HttpClient);
    const s = await q.waitForQuotes('s1', { intervalMs: 1, timeoutMs: 10_000 });
    expect(s.allCarriersResolved).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('Payments, Bonds, Claims', () => {
  it('payments list + checkout', async () => {
    const { http, request } = mockHttp({ data: { payments: [{ id: 'p1' }], checkoutUrl: 'https://x' } });
    const p = new PaymentsModule(http);
    expect((await p.list())[0].id).toBe('p1');
    await p.checkout('p1');
    expect(request.mock.calls[1][0]).toMatchObject({ method: 'POST', path: '/api/v1/payments/p1/checkout' });
  });

  it('bonds start / answer / status', async () => {
    const { http, request } = mockHttp({ data: { session_id: 'b1' } });
    const b = new BondsModule(http);
    await b.start({ state: 'TX', bondName: 'notary' });
    await b.answer('b1', { q: 1 });
    await b.status('b1');
    expect(request.mock.calls.map((c) => c[0].path)).toEqual(['/api/v1/bonds/quote', '/api/v1/bonds/quote/b1/answers', '/api/v1/bonds/quote/b1']);
  });

  it('claims file / list with filters / get', async () => {
    const { http, request } = mockHttp({ data: { claims: [], claimId: 'c1' } });
    const c = new ClaimsModule(http);
    await c.file({ description: 'Pipe burst' });
    await c.list({ status: 'open', limit: 5 });
    await c.get('c1');
    expect(request.mock.calls[0][0].headers['Idempotency-Key']).toBeTruthy();
    expect(request.mock.calls[1][0].path).toBe('/api/v1/claims?status=open&limit=5');
    expect(request.mock.calls[2][0].path).toBe('/api/v1/claims/c1');
  });
});

describe('HttpClient error reason + unauthenticated calls', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('omits Authorization with no key and surfaces reason/body on errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'account_exists', reason: 'account_exists', traceId: 't' }),
      headers: { get: () => null },
    });
    vi.stubGlobal('fetch', fetchMock);
    const http = new HttpClient({ apiKey: '', retries: 0 });
    const err: any = await http.request({ method: 'POST', path: '/x', body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(DeleganceError);
    expect(err.reason).toBe('account_exists');
    expect(err.body).toMatchObject({ reason: 'account_exists' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it('reads Retry-After from the header on a 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 429, json: async () => ({ error: 'x' }), headers: { get: (h: string) => (h === 'Retry-After' ? '42' : null) },
    }));
    const err: any = await new HttpClient({ apiKey: 'dlg_k', retries: 0 }).request({ method: 'GET', path: '/x' }).catch((e) => e);
    expect(err.retryAfter).toBe(42);
  });
});
describe('TermsModule', () => {
  it('accept posts the version with termsAccepted true', async () => {
    const { http, request } = mockHttp({ data: { version: '2026-09-24', acceptedAt: '2026-09-24T12:00:00Z' } });
    expect(await new TermsModule(http).accept('2026-09-24')).toEqual({ version: '2026-09-24', acceptedAt: '2026-09-24T12:00:00Z' });
    expect(request.mock.calls[0][0]).toEqual({
      method: 'POST',
      path: '/api/v1/legal/terms/accept',
      body: { termsAccepted: true, termsVersion: '2026-09-24' },
    });
  });
});

describe('InstantQuotesModule broker handoff (no-carrier result)', () => {
  it('asks for the ACORD questions with the answers already given', async () => {
    const { http, request } = mockHttp({ data: { submissionId: 's1', coverages: ['general_liability'], questions: [], alreadyHandedOff: false } });
    const r = await new InstantQuotesModule(http).brokerHandoffQuestions('s1', { cf_fein: '12-3456789' });
    expect(r.submissionId).toBe('s1');
    const call = request.mock.calls[0][0];
    expect(call.method).toBe('POST');
    expect(call.path).toBe('/api/v1/quotes/instant/s1/broker-handoff/questions');
    expect(call.body).toEqual({ instantAnswers: { cf_fein: '12-3456789' } });
  });

  it('hands off with an Idempotency-Key, reusing a caller key', async () => {
    const { http, request } = mockHttp({ data: { status: 'broker_review', submissionId: 's1', brokerTaskId: 't1', coverages: [], unansweredRequired: 0, alreadyHandedOff: false } });
    const mod = new InstantQuotesModule(http);
    const r = await mod.brokerHandoff('s1', { answers: { fein: '1' }, complete: false });
    expect(r.brokerTaskId).toBe('t1');
    const call = request.mock.calls[0][0];
    expect(call.path).toBe('/api/v1/quotes/instant/s1/broker-handoff');
    expect(call.body).toEqual({ answers: { fein: '1' }, complete: false });
    expect(call.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    await mod.brokerHandoff('s1', { answers: {} }, { idempotencyKey: 'mine-12345678' });
    expect(request.mock.calls[1][0].headers['Idempotency-Key']).toBe('mine-12345678');
  });
});
