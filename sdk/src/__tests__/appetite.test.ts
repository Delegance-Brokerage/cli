import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppetiteModule } from '../modules/appetite';
import { ValidationError, DeleganceError } from '../types';
import type { HttpClient } from '../utils/http';

function createMockHttp(): HttpClient {
  return { request: vi.fn(), uploadFile: vi.fn() } as unknown as HttpClient;
}

const result = {
  matches: [],
  carrierResults: [],
  suggestedCarriers: ['Hiscox'],
  warnings: [],
  metadata: { totalCandidates: 3, processingTimeMs: 10, queryEmbeddingCached: true, validated: true },
};

describe('AppetiteModule', () => {
  let http: HttpClient;
  let appetite: AppetiteModule;
  const req = () => http.request as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    http = createMockHttp();
    appetite = new AppetiteModule(http);
  });

  describe('match', () => {
    it('POSTs /api/v1/appetite/match with the input body', async () => {
      req().mockResolvedValue({ success: true, cached: true, jobId: null, traceId: 't1', ...result });
      await appetite.match({ state: 'CA', industry: 'bakery' });
      expect(req()).toHaveBeenCalledWith({
        method: 'POST',
        path: '/api/v1/appetite/match',
        body: { state: 'CA', industry: 'bakery' },
      });
    });

    it('returns a succeeded result on a warm hit, without the envelope flag', async () => {
      req().mockResolvedValue({ success: true, cached: true, jobId: null, traceId: 't1', ...result });
      const start = await appetite.match({ state: 'CA', industry: 'bakery' });
      expect(start.status).toBe('succeeded');
      expect(start).not.toHaveProperty('success');
      if (start.status === 'succeeded') expect(start.suggestedCarriers).toEqual(['Hiscox']);
    });

    it('returns a queued job on a cold miss', async () => {
      req().mockResolvedValue({
        success: true,
        jobId: '11111111-1111-1111-1111-111111111111',
        statusUrl: '/api/v1/appetite/match/11111111-1111-1111-1111-111111111111',
        estimatedSeconds: 20,
        traceId: 't2',
      });
      const start = await appetite.match({ state: 'tx', naicsCode: '311811' });
      expect(start).toEqual({
        status: 'queued',
        jobId: '11111111-1111-1111-1111-111111111111',
        statusUrl: '/api/v1/appetite/match/11111111-1111-1111-1111-111111111111',
        estimatedSeconds: 20,
        traceId: 't2',
      });
    });

    it('rejects a missing business descriptor before calling the API', async () => {
      await expect(appetite.match({ state: 'CA' })).rejects.toThrow(ValidationError);
      expect(req()).not.toHaveBeenCalled();
    });

    it('rejects a state that is not two letters', async () => {
      await expect(appetite.match({ state: 'Cal', industry: 'x' })).rejects.toThrow(ValidationError);
      expect(req()).not.toHaveBeenCalled();
    });
  });

  describe('getMatch', () => {
    it('GETs the job by id', async () => {
      req().mockResolvedValue({ success: true, status: 'running', jobId: 'j', estimatedSeconds: 20, traceId: 't' });
      const job = await appetite.getMatch('j');
      expect(req()).toHaveBeenCalledWith({ method: 'GET', path: '/api/v1/appetite/match/j' });
      expect(job.status).toBe('running');
    });
  });

  describe('waitForMatch', () => {
    it('polls until the job succeeds', async () => {
      req()
        .mockResolvedValueOnce({ success: true, status: 'queued', jobId: 'j', estimatedSeconds: 20, traceId: 't' })
        .mockResolvedValueOnce({ success: true, status: 'succeeded', jobId: 'j', cached: false, traceId: 't', ...result });
      const done = await appetite.waitForMatch('j', { intervalMs: 1, timeoutMs: 1000 });
      expect(done.status).toBe('succeeded');
      expect(req()).toHaveBeenCalledTimes(2);
    });

    it('throws with the sanitized error code when the job fails', async () => {
      req().mockResolvedValue({
        success: false, status: 'failed', jobId: 'j', errorCode: 'timeout', retryable: true, traceId: 't',
      });
      await expect(appetite.waitForMatch('j', { intervalMs: 1 })).rejects.toThrow(/timeout \(retryable\)/);
    });

    it('rejects a NaN timeout instead of polling forever', async () => {
      await expect(appetite.waitForMatch('j', { timeoutMs: Number.NaN })).rejects.toThrow(ValidationError);
      expect(req()).not.toHaveBeenCalled();
    });

    it('throws on timeout while the job is still running', async () => {
      req().mockResolvedValue({ success: true, status: 'running', jobId: 'j', estimatedSeconds: 20, traceId: 't' });
      await expect(appetite.waitForMatch('j', { intervalMs: 5, timeoutMs: 1 })).rejects.toThrow(DeleganceError);
    });
  });
});
