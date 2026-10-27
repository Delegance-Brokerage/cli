import { describe, it, expect, vi } from 'vitest';
import { PoliciesModule } from '../modules/policies';
import type { HttpClient } from '../utils/http';

describe('PoliciesModule cancellation', () => {
  it('posts to the policy cancellation route with an Idempotency-Key', async () => {
    const http = { request: vi.fn().mockResolvedValue({ request: { id: 'r1', status: 'awaiting_signature' }, signatureUrl: 'https://p/x' }) } as unknown as HttpClient;
    const out = await new PoliciesModule(http).requestCancellation('pol 1', { requestedEffectiveDate: '2026-10-01', reason: 'not_needed' }, { idempotencyKey: 'k-12345678' });
    expect(out.signatureUrl).toBe('https://p/x');
    expect((http.request as any).mock.calls[0][0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/policies/pol%201/cancellation',
      headers: { 'Idempotency-Key': 'k-12345678' },
      body: { requestedEffectiveDate: '2026-10-01', reason: 'not_needed' },
    });
  });

  it('mints an Idempotency-Key when none is given', async () => {
    const http = { request: vi.fn().mockResolvedValue({ request: {}, signatureUrl: '' }) } as unknown as HttpClient;
    await new PoliciesModule(http).requestCancellation('p', { requestedEffectiveDate: '2026-10-01', reason: 'other' });
    expect((http.request as any).mock.calls[0][0].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('reads one request by id', async () => {
    const http = { request: vi.fn().mockResolvedValue({ request: { id: 'r1', status: 'confirmed' } }) } as unknown as HttpClient;
    expect(await new PoliciesModule(http).getCancellation('r1')).toEqual({ id: 'r1', status: 'confirmed' });
    expect((http.request as any).mock.calls[0][0].path).toBe('/api/v1/policy-cancellations/r1');
  });

  it('signs through the sign endpoint, with a fresh Idempotency-Key per call', async () => {
    const http = { request: vi.fn().mockResolvedValue({ stepUpRequired: true, stepUpId: 's1', sentTo: 'a***@x.com' }) } as unknown as HttpClient;
    const m = new PoliciesModule(http);
    const first = await m.signCancellation('r 1', { signerName: 'Ann', signerTitle: 'Owner', attestAuthority: true });
    expect(first).toMatchObject({ stepUpRequired: true, stepUpId: 's1' });
    await m.signCancellation('r 1', { signerName: 'Ann', signerTitle: 'Owner', attestAuthority: true, stepUpId: 's1', code: '123456' });
    const [a, b] = (http.request as any).mock.calls.map((c: any[]) => c[0]);
    expect(a).toMatchObject({ method: 'POST', path: '/api/v1/policy-cancellations/r%201/sign' });
    expect(b.body).toMatchObject({ stepUpId: 's1', code: '123456' });
    expect(a.headers['Idempotency-Key']).not.toBe(b.headers['Idempotency-Key']);
  });
});
