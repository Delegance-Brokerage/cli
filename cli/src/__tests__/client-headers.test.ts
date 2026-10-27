import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { OutcomeUnknownError } from '@delegance/sdk';
import { describeApiError, getClient } from '../utils/client';
import { CLI_CLIENT_HEADERS, CLI_VERSION } from '../version';

vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

vi.mock('../utils/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/config')>()),
  getApiKey: () => 'dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345',
  getBaseUrl: () => 'https://api.test.com',
}));

describe('X-Delegance-Client from the CLI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the CLI and its version, plus the API version, on a real request', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true, companies: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    await getClient().companies.list();
    const headers = new Headers((fetchSpy.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('X-Delegance-Client')).toBe(`cli/${CLI_VERSION}`);
    expect(headers.get('Delegance-Version')).toBe('2026-10-01');
  });

  it('matches the server format check', () => {
    expect(CLI_CLIENT_HEADERS['X-Delegance-Client']).toMatch(/^(cli|sdk|ios|android|web)\/[0-9A-Za-z.+-]{1,32}$/);
  });

  // Every SDK client the CLI builds must carry the header, or the server
  // reads that call as an SDK call and the CLI version gate misses it.
  it('every SDK client construction in the CLI passes CLI_CLIENT_HEADERS', () => {
    const srcRoot = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(srcRoot);
    const missing: string[] = [];
    let seen = 0;
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const re = /(new DeleganceClient|createSignup|createDeviceLogin)\(\{([\s\S]*?)\}\)/g;
      for (const m of text.matchAll(re)) {
        seen++;
        if (!m[2].includes('CLI_CLIENT_HEADERS')) missing.push(`${file.slice(srcRoot.length)}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(seen).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });
});

describe('describeApiError on a write with an unknown outcome', () => {
  it('tells the user to check before running it again', () => {
    const err = new OutcomeUnknownError('POST /api/v1/coi: no response within 30000 ms.', 'POST', '/api/v1/coi', true);
    const out = describeApiError(err);
    expect(out.message).toContain('POST /api/v1/coi');
    expect(out.hint).toMatch(/may have gone through/);
  });
});
