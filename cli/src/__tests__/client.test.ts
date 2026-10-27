import { describe, it, expect, vi } from 'vitest';

import {
  AuthenticationError,
  DeleganceError,
  ForbiddenError,
  NotFoundError,
  NotImplementedError,
  OutcomeUnknownError,
  RateLimitError,
  ValidationError,
} from '@delegance/sdk';
import { describeApiError, failWith, getClient, PORTAL_URL } from '../utils/client';
import { reportUncaughtError } from '../support';
import * as output from '../utils/output';

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
  getApiKey: () => undefined,
}));

describe('getClient with no credentials', () => {
  it('exits 1 with signup and login hints, not a stack trace', () => {
    const errorSpy = vi.spyOn(output, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(output, 'info').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      expect(() => getClient()).toThrow('exit 1');
      expect(errorSpy).toHaveBeenCalledWith('Not authenticated');
      const hints = infoSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(hints).toContain('delegance signup');
      expect(hints).toContain('delegance auth login');
    } finally {
      errorSpy.mockRestore();
      infoSpy.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('describeApiError', () => {
  it('points a 501 at the portal and keeps the server message and trace', () => {
    const out = describeApiError(new NotImplementedError('Quote submission is not currently available.', 'tr-1'));
    expect(out.message).toBe('Quote submission is not currently available. (trace tr-1)');
    expect(out.hint).toContain(PORTAL_URL);
  });

  it('explains a 403 as a missing scope', () => {
    expect(describeApiError(new ForbiddenError('Write scope required')).hint).toMatch(/scope/);
  });

  it('suggests re-authenticating on 401', () => {
    expect(describeApiError(new AuthenticationError('Invalid API key')).hint).toMatch(/auth status/);
  });

  it('includes Retry-After on 429', () => {
    expect(describeApiError(new RateLimitError('Slow down', 30)).hint).toBe('Rate limited. Retry in 30s.');
  });

  it('passes other SDK errors through with their trace id', () => {
    expect(describeApiError(new DeleganceError('boom', 500, 'tr-9')).message).toBe('boom (trace tr-9)');
  });

  it('handles a non-Error throw', () => {
    expect(describeApiError('weird').message).toBe('weird');
  });
});

describe('support line on unexpected errors', () => {
  const SUPPORT = 'Need help? Email support@delegancebrokerage.com or run "delegance feedback".';

  it.each([
    ['a 500', new DeleganceError('boom', 500)],
    ['a 503', new DeleganceError('down', 503)],
    ['a network failure on a read', new TypeError('fetch failed')],
    ['a write with no response', new OutcomeUnknownError('POST /v1/coi: no response', 'POST', '/v1/coi', true)],
    ['a non-Error throw', 'weird'],
  ])('names support on %s', (_label, err) => {
    expect(describeApiError(err).support).toBe(SUPPORT);
  });

  it.each([
    ['a 400', new ValidationError('bad field')],
    ['a 401', new AuthenticationError('Invalid API key')],
    ['a 403', new ForbiddenError('Write scope required')],
    ['a 404', new NotFoundError('No such policy')],
    ['a 429', new RateLimitError('Slow down', 30)],
    ['a 501', new NotImplementedError('Not yet')],
  ])('leaves it off %s, which carries its own fix', (_label, err) => {
    expect(describeApiError(err).support).toBeUndefined();
  });

  it('failWith prints it on stderr, apart from stdout', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      expect(() => failWith('API error', new DeleganceError('boom', 502, 'tr-3'))).toThrow('exit 1');
      expect(stderr.mock.calls.map((c) => String(c[0]))).toContain(SUPPORT);
      expect(stdout.mock.calls.map((c) => String(c[0])).join('\n')).not.toContain('support@');
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('failWith exits 130 without a message when a command catches a prompt cancel', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    try {
      const cancel = Object.assign(new Error('User force closed the prompt with SIGINT'), { name: 'ExitPromptError' });
      expect(() => failWith('API error', cancel)).toThrow('exit 130');
      expect(stderr).not.toHaveBeenCalled();
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
      exitSpy.mockRestore();
    }
  });
});

describe('reportUncaughtError', () => {
  it('prints the message and the support line, and exits 1', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(reportUncaughtError(new Error('kaboom'), {})).toBe(1);
      const lines = stderr.mock.calls.map((c) => String(c[0])).join('\n');
      expect(lines).toContain('kaboom');
      expect(lines).toContain('support@delegancebrokerage.com');
      expect(lines).not.toContain('at ');
    } finally {
      stderr.mockRestore();
    }
  });

  it('exits 130 without a message on Ctrl+C in a prompt', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(reportUncaughtError(new Error('User force closed the prompt with SIGINT'), {})).toBe(130);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });
});
