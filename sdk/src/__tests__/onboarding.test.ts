import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnboardingModule } from '../modules/onboarding';
import type { OnboardingStatus } from '../modules/onboarding';
import type { HttpClient } from '../utils/http';

function createMockHttp(): HttpClient {
  return { request: vi.fn(), uploadFile: vi.fn() } as unknown as HttpClient;
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

function sandboxStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    account: 'complete',
    company: 'minimum',
    companyFull: 'incomplete',
    billing: 'sandbox',
    quoteReady: false,
    sandbox: true,
    nextStep: {
      action: 'complete_company_profile',
      fields: ['contact_email', 'street_address'],
      url: '/portal/settings/company',
    },
    ...overrides,
  };
}

function productionStatus(overrides: Partial<OnboardingStatus> = {}): OnboardingStatus {
  return {
    account: 'complete',
    company: 'complete',
    companyFull: 'complete',
    billing: 'active',
    quoteReady: true,
    sandbox: false,
    nextStep: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OnboardingModule', () => {
  let http: HttpClient;
  let onboarding: OnboardingModule;

  beforeEach(() => {
    http = createMockHttp();
    onboarding = new OnboardingModule(http);
  });

  describe('status()', () => {
    it('sends GET /api/v1/onboarding/status', async () => {
      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: sandboxStatus(),
        traceId: 'trace-1',
      });

      await onboarding.status();

      expect(http.request).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/v1/onboarding/status',
      });
    });

    it('returns full OnboardingStatus shape for a sandbox company', async () => {
      const expected = sandboxStatus();

      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: expected,
        traceId: 'trace-2',
      });

      const result = await onboarding.status();

      expect(result.account).toBe('complete');
      expect(result.company).toBe('minimum');
      expect(result.companyFull).toBe('incomplete');
      expect(result.billing).toBe('sandbox');
      expect(result.quoteReady).toBe(false);
      expect(result.sandbox).toBe(true);
      expect(result.nextStep).not.toBeNull();
      expect(result.nextStep?.action).toBe('complete_company_profile');
      expect(result.nextStep?.fields).toContain('contact_email');
    });

    it('returns full OnboardingStatus shape for a production-ready company', async () => {
      const expected = productionStatus();

      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: expected,
        traceId: 'trace-3',
      });

      const result = await onboarding.status();

      expect(result.account).toBe('complete');
      expect(result.company).toBe('complete');
      expect(result.companyFull).toBe('complete');
      expect(result.billing).toBe('active');
      expect(result.quoteReady).toBe(true);
      expect(result.sandbox).toBe(false);
      expect(result.nextStep).toBeNull();
    });

    it('returns nextStep with fields and url when company profile is incomplete', async () => {
      const status = sandboxStatus({
        company: 'minimum',
        companyFull: 'incomplete',
        nextStep: {
          action: 'complete_company_profile',
          fields: ['contact_email', 'street_address', 'city', 'state'],
          url: '/portal/settings/company',
        },
      });

      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: status,
        traceId: 'trace-4',
      });

      const result = await onboarding.status();

      expect(result.nextStep?.action).toBe('complete_company_profile');
      expect(result.nextStep?.fields).toHaveLength(4);
      expect(result.nextStep?.url).toBe('/portal/settings/company');
    });

    it('returns nextStep with action only (no fields or url) for billing upgrade prompt', async () => {
      const status = productionStatus({
        billing: 'sandbox',
        sandbox: true,
        quoteReady: false,
        nextStep: { action: 'upgrade_plan' },
      });

      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: status,
        traceId: 'trace-5',
      });

      const result = await onboarding.status();

      expect(result.nextStep?.action).toBe('upgrade_plan');
      expect(result.nextStep?.fields).toBeUndefined();
      expect(result.nextStep?.url).toBeUndefined();
    });

    it('reports past_due billing correctly', async () => {
      const status = productionStatus({
        billing: 'past_due',
        quoteReady: false,
        nextStep: { action: 'update_payment_method', url: '/portal/billing' },
      });

      (http.request as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        data: status,
        traceId: 'trace-6',
      });

      const result = await onboarding.status();

      expect(result.billing).toBe('past_due');
      expect(result.quoteReady).toBe(false);
      expect(result.nextStep?.url).toBe('/portal/billing');
    });

    it('propagates HTTP errors from the underlying request', async () => {
      const networkError = new Error('Network timeout');
      (http.request as ReturnType<typeof vi.fn>).mockRejectedValue(networkError);

      await expect(onboarding.status()).rejects.toThrow('Network timeout');
    });
  });
});

// ── WS1 state machine additions ──────────────────────────────────────────────

function httpReturning(sequence: unknown[]) {
  let i = 0;
  return {
    request: vi.fn(async () => sequence[Math.min(i++, sequence.length - 1)]),
  } as unknown as HttpClient;
}

describe('onboarding.state()', () => {
  it('GETs /api/v1/onboarding/state and unwraps data', async () => {
    const http = httpReturning([
      {
        success: true,
        traceId: 't',
        data: {
          state: 'awaiting_verification',
          verified: false,
          capabilities: ['create_company', 'poll_onboarding', 'request_verification'],
          verification: { challengeIssued: true, sentTo: 'o***@acme.com' },
          documents: { total: 0, processing: 0, processed: 0 },
        },
      },
    ]);
    const mod = new OnboardingModule(http);
    const s = await mod.state();
    expect(http.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/v1/onboarding/state',
    });
    expect(s.state).toBe('awaiting_verification');
  });
});

describe('onboarding.requestVerification()', () => {
  it('POSTs the verification challenge', async () => {
    const http = httpReturning([
      {
        success: true,
        traceId: 't',
        data: { state: 'awaiting_verification', method: 'email_link', sentTo: 'o***@acme.com' },
      },
    ]);
    const mod = new OnboardingModule(http);
    const r = await mod.requestVerification();
    expect(http.request).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/v1/onboarding/verification',
    });
    expect(r.sentTo).toBe('o***@acme.com');
  });
});

describe('onboarding.waitForState()', () => {
  it('polls until the target state and resolves', async () => {
    const pending = {
      success: true,
      traceId: 't',
      data: {
        state: 'processing',
        verified: true,
        capabilities: [],
        verification: { challengeIssued: true, sentTo: null },
        documents: { total: 1, processing: 1, processed: 0 },
      },
    };
    const ready = {
      ...pending,
      data: { ...pending.data, state: 'ready', documents: { total: 1, processing: 0, processed: 1 } },
    };
    const http = httpReturning([pending, pending, ready]);
    const mod = new OnboardingModule(http);
    const s = await mod.waitForState('ready', { intervalMs: 1, timeoutMs: 5000 });
    expect(s.state).toBe('ready');
    expect(http.request).toHaveBeenCalledTimes(3);
  });

  it('rejects on timeout', async () => {
    const stuck = {
      success: true,
      traceId: 't',
      data: {
        state: 'processing',
        verified: true,
        capabilities: [],
        verification: { challengeIssued: true, sentTo: null },
        documents: { total: 1, processing: 1, processed: 0 },
      },
    };
    const mod = new OnboardingModule(httpReturning([stuck]));
    await expect(
      mod.waitForState('ready', { intervalMs: 1, timeoutMs: 10 })
    ).rejects.toThrow(/timed out/i);
  });

  describe('waitForState input guard', () => {
    it('rejects a NaN interval instead of polling forever', async () => {
      const { OnboardingModule } = await import('../modules/onboarding');
      const { ValidationError } = await import('../types');
      const request = vi.fn();
      const mod = new OnboardingModule({ request, uploadFile: vi.fn() } as never);
      await expect(mod.waitForState('ready', { intervalMs: Number.NaN })).rejects.toThrow(ValidationError);
      expect(request).not.toHaveBeenCalled();
    });
  });
});
