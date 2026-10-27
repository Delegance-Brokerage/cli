/**
 * `delegance auth login` (browser device flow by default), `auth refresh`,
 * and the helpers behind `auth status` (spec 2026-09-24-cli-auth-hardening).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sdk = vi.hoisted(() => ({
  start: vi.fn(),
  waitForKey: vi.fn(),
  refresh: vi.fn(),
  keyInfo: vi.fn(),
}));
const stored = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]>, config: {} as Record<string, unknown> }));
const opened = vi.hoisted(() => ({ urls: [] as string[] }));

vi.mock('@delegance/sdk', async () => {
  const actual = await vi.importActual<typeof import('@delegance/sdk')>('@delegance/sdk');
  class DeleganceClient {
    auth = { refresh: sdk.refresh, keyInfo: sdk.keyInfo };
    constructor(public cfg: unknown) {}
  }
  return {
    ...actual,
    DeleganceClient,
    createDeviceLogin: vi.fn(() => ({ start: sdk.start, waitForKey: sdk.waitForKey })),
    newDeviceSecret: vi.fn(() => ({ secret: 's'.repeat(64), hash: 'h'.repeat(64) })),
  };
});

vi.mock('../utils/config', async () => {
  const actual = await vi.importActual<typeof import('../utils/config')>('../utils/config');
  return {
    ...actual,
    migrateLegacyConfigKey: vi.fn(() => 'none'),
    storeApiKey: vi.fn((key: string, meta: unknown) => stored.calls.push([key, meta])),
    setConfig: vi.fn((k: string, v: unknown) => { stored.config[k] = v; }),
    setStoredKeyExpiry: vi.fn((v: unknown) => { stored.config.apiKeyExpiresAt = v; }),
    getApiKey: vi.fn(() => 'dlg_abcd1234_sk_abcdefghijklmnopqrstuvwxyz012345'),
    getBaseUrl: vi.fn(() => 'https://portal.example'),
  };
});

vi.mock('../utils/browser', async () => ({
  ...(await vi.importActual<typeof import('../utils/browser')>('../utils/browser')),
  openInBrowser: vi.fn((u: string) => { opened.urls.push(u); return true; }),
}));

vi.mock('conf', () => {
  class MockConf {
    private store: Record<string, unknown> = {};
    get(key: string) { return this.store[key]; }
    set(key: string, value: unknown) { this.store[key] = value; }
    delete(key: string) { delete this.store[key]; }
    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

import { DeleganceError } from '@delegance/sdk';
import { createProgram } from '../program';
import { describeExpiry, deviceLoginRefusal, defaultDeviceName } from '../commands/auth';
import { openerFor } from '../utils/browser';

const START = {
  loginId: 'l1',
  userCode: 'BCDF-GHJK',
  verificationUri: 'https://portal.example/portal/cli/device',
  verificationUriComplete: 'https://portal.example/portal/cli/device?code=BCDF-GHJK',
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  interval: 5,
};

async function run(...args: string[]): Promise<{ out: string; exitCode: number | null }> {
  let out = '';
  let exitCode: number | null = null;
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { out += `${a.join(' ')}\n`; });
  const err = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { out += `${a.join(' ')}\n`; });
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`exit ${code}`);
  }) as never);
  try {
    await createProgram().parseAsync(['node', 'delegance', ...args]);
  } catch (e) {
    if (!String(e).includes('exit')) throw e;
  } finally {
    log.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  }
  return { out, exitCode };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored.calls.length = 0;
  stored.config = {};
  opened.urls.length = 0;
});

describe('auth login (browser)', () => {
  it('prints the link and code, polls, and stores the key with its expiry', async () => {
    sdk.start.mockResolvedValue(START);
    sdk.waitForKey.mockResolvedValue({
      status: 'ready',
      apiKey: 'dlg_abcd1234_sk_abcdefghijklmnopqrstuvwxyz012345',
      keyPrefix: 'dlg_abcd1234',
      companyId: 'co-1',
      scopes: ['read', 'write'],
      expiresAt: '2026-12-23T00:00:00.000Z',
    });
    const { out, exitCode } = await run('auth', 'login', '--no-browser');
    expect(exitCode).toBeNull();
    expect(out).toContain(START.verificationUriComplete);
    expect(out).toContain('BCDF-GHJK');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(sdk.start).toHaveBeenCalledWith({ deviceSecretHash: 'h'.repeat(64), deviceName: expect.any(String) });
    expect(sdk.waitForKey).toHaveBeenCalledWith('l1', 's'.repeat(64), expect.objectContaining({ intervalMs: 5000 }));
    expect(stored.calls).toEqual([['dlg_abcd1234_sk_abcdefghijklmnopqrstuvwxyz012345', { expiresAt: '2026-12-23T00:00:00.000Z' }]]);
    expect(stored.config.defaultCompanyId).toBe('co-1');
    expect(opened.urls).toEqual([]);
  });

  it('falls back to the paste hint when the server has no browser login', async () => {
    sdk.start.mockRejectedValue(Object.assign(new DeleganceError('Not Found', 404), {}));
    const { out, exitCode } = await run('auth', 'login', '--no-browser');
    expect(exitCode).toBe(1);
    expect(out).toContain('auth login --key');
    expect(stored.calls).toEqual([]);
  });

  it('stores nothing when the portal user denies', async () => {
    sdk.start.mockResolvedValue(START);
    sdk.waitForKey.mockRejectedValue(Object.assign(new DeleganceError('denied', 403), { reason: 'access_denied' }));
    const { out, exitCode } = await run('auth', 'login', '--no-browser');
    expect(exitCode).toBe(1);
    expect(out).toContain('denied');
    expect(stored.calls).toEqual([]);
  });

  it('says the code expired when the wait times out', async () => {
    sdk.start.mockResolvedValue(START);
    sdk.waitForKey.mockResolvedValue({ status: 'pending' });
    const { exitCode } = await run('auth', 'login', '--no-browser');
    expect(exitCode).toBe(1);
    expect(stored.calls).toEqual([]);
  });

  it('keeps --key as the paste fallback (no device flow)', async () => {
    const { exitCode } = await run('auth', 'login', '--key', 'dlg_abcd1234_sk_abcdefghijklmnopqrstuvwxyz012345', '--skip-verify');
    expect(exitCode).toBeNull();
    expect(sdk.start).not.toHaveBeenCalled();
    expect(stored.calls[0][0]).toBe('dlg_abcd1234_sk_abcdefghijklmnopqrstuvwxyz012345');
  });
});

describe('auth refresh', () => {
  it('stores the new expiry', async () => {
    sdk.refresh.mockResolvedValue({ expiresAt: '2026-12-23T00:00:00.000Z' });
    const { exitCode } = await run('auth', 'refresh');
    expect(exitCode).toBeNull();
    expect(stored.config.apiKeyExpiresAt).toBe('2026-12-23T00:00:00.000Z');
  });

  it('explains that a portal key is not refreshable', async () => {
    sdk.refresh.mockRejectedValue(Object.assign(new DeleganceError('no', 400), { reason: 'not_refreshable' }));
    const { out, exitCode } = await run('auth', 'refresh');
    expect(exitCode).toBeNull();
    expect(out).toContain('keeps the expiry');
  });
});

describe('auth status', () => {
  beforeEach(() => {
    process.env.DELEGANCE_API_KEY = 'dlg_abcd1234_sk_abcdefghijklmnopqrstuvwxyz012345';
  });
  afterEach(() => {
    delete process.env.DELEGANCE_API_KEY;
  });

  it('does not say Authenticated for a revoked or rejected key', async () => {
    sdk.keyInfo.mockRejectedValue(Object.assign(new DeleganceError('nope', 401), { reason: 'key_membership_revoked' }));
    const { out } = await run('auth', 'status');
    expect(out).not.toContain('Authenticated');
    expect(out).toContain('revoked');
    sdk.keyInfo.mockRejectedValue(new DeleganceError('Unauthorized', 401));
    expect((await run('auth', 'status')).out).toContain('rejected');
  });

  it('keeps Authenticated with the cached expiry when the server is unreachable', async () => {
    sdk.keyInfo.mockRejectedValue(new Error('fetch failed'));
    const { out } = await run('auth', 'status');
    expect(out).toContain('Authenticated');
  });

  it('shows the expiry the server reports', async () => {
    sdk.keyInfo.mockResolvedValue({ origin: 'cli_login', expiresAt: '2030-06-15T12:00:00.000Z' });
    const { out } = await run('auth', 'status');
    expect(out).toContain('2030');
    expect(out).toContain('browser login');
  });
});

describe('helpers', () => {
  it('describes expiry', () => {
    const now = new Date('2026-09-24T12:00:00Z');
    expect(describeExpiry(null, now)).toBe('Never');
    // describeExpiry prints the local calendar date, so build the expectation the same way:
    // a hard-coded day shifts by one in far-east or far-west time zones.
    const localDay = new Date('2026-12-23T12:00:00Z').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    expect(describeExpiry('2026-12-23T12:00:00Z', now)).toBe(`${localDay} (in 90 days)`);
    expect(describeExpiry('2026-09-01T00:00:00Z', now)).toMatch(/expired/);
  });

  it('maps device-login refusals', () => {
    expect(deviceLoginRefusal(Object.assign(new DeleganceError('x', 410), { reason: 'expired' }))).toContain('expired');
    expect(deviceLoginRefusal(Object.assign(new DeleganceError('x', 409), { reason: 'already_collected' }))).toContain('already used');
    expect(deviceLoginRefusal(new Error('x'))).toBeNull();
  });

  it('names the device for the approver, at most 64 characters', () => {
    expect(defaultDeviceName().length).toBeGreaterThan(0);
    expect(defaultDeviceName().length).toBeLessThanOrEqual(64);
  });

  it('opens the browser with a platform opener and no shell', () => {
    expect(openerFor('darwin')).toEqual({ cmd: 'open', args: [] });
    expect(openerFor('linux')).toEqual({ cmd: 'xdg-open', args: [] });
    expect(openerFor('win32')).toEqual({ cmd: 'rundll32', args: ['url.dll,FileProtocolHandler'] });
  });
});
