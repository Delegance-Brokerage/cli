import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import type { Command } from 'commander';
import { createProgram } from '../program';
import { CLI_VERSION } from '../version';
import { parseExpiresInDays, parseScopes, replacementExpiryDays } from '../commands/keys';
import { buildMatchInput } from '../commands/appetite';
import { buildLeadInput } from '../commands/lead';
import { isoDay } from '../commands/usage';
import { ONBOARDING_STATES } from '../commands/onboarding';

// config.ts builds a Conf store at import time; keep it off the real disk.
vi.mock('conf', () => {
  class MockConf {
    private store: Record<string, unknown> = {};

    get(key: string) { return this.store[key]; }

    set(key: string, value: unknown) { this.store[key] = value; }

    delete(key: string) { delete this.store[key]; }

    clear() { this.store = {}; }

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

function subcommands(program: Command, name: string): string[] {
  const cmd = program.commands.find(c => c.name() === name);
  if (!cmd) throw new Error(`missing command ${name}`);
  return cmd.commands.map(c => c.name()).sort();
}

function helpText(cmd: Command): string {
  let out = '';
  cmd.configureOutput({ writeOut: (s) => { out += s; } });
  cmd.outputHelp();
  return out;
}

describe('help footer', () => {
  it('ends the root help with the support line', () => {
    const text = helpText(createProgram()).trimEnd();
    expect(text.split('\n').pop()).toBe('Need help? Email support@delegancebrokerage.com or run "delegance feedback".');
  });

  it('keeps subcommand help free of it', () => {
    const quote = createProgram().commands.find(c => c.name() === 'quote')!;
    expect(helpText(quote)).not.toContain('support@');
  });
});

describe('command tree', () => {
  const program = createProgram();

  it('registers every top-level command', () => {
    expect(program.commands.map(c => c.name()).sort()).toEqual([
      'appetite', 'ask', 'auth', 'billing', 'bind', 'bond', 'claim', 'coi', 'company', 'config', 'doc', 'feedback', 'keys',
      'knowledge', 'lead', 'onboarding', 'pay', 'policy', 'quote', 'signup', 'sov', 'terms', 'usage', 'verify',
    ]);
  });

  it.each([
    ['onboarding', ['state', 'status', 'verify', 'wait']],
    ['knowledge', ['facts', 'notecards', 'search']],
    ['usage', ['daily', 'limits', 'summary']],
    ['keys', ['create', 'list', 'revoke', 'rotate']],
    ['appetite', ['match', 'status']],
    ['lead', ['create']],
    ['doc', ['archive', 'list', 'reprocess', 'status', 'unarchive', 'upload', 'wait']],
    ['quote', ['cancel', 'carriers', 'get', 'handoff', 'list', 'request', 'start', 'status', 'submit', 'wait']],
    ['bond', ['answer', 'quote', 'status']],
    ['claim', ['file', 'list', 'status']],
    ['terms', ['accept']],
    ['policy', ['cancel', 'cancellation', 'docs', 'expiring', 'get', 'list', 'sign']],
  ])('%s has its subcommands', (name, expected) => {
    expect(subcommands(program, name)).toEqual(expected);
  });

  it('policy sign takes the step-up id and code for scripts; policy cancel can sign in one go', () => {
    const policy = program.commands.find(c => c.name() === 'policy')!;
    const opts = (n: string) => policy.commands.find(c => c.name() === n)!.options.map(o => o.long);
    expect(opts('sign')).toEqual(expect.arrayContaining(['--signer-name', '--signer-title', '--attest', '--step-up', '--code']));
    expect(opts('cancel')).toEqual(expect.arrayContaining(['--signer-name', '--signer-title', '--attest']));
  });

  it('reports the package.json version', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
    expect(CLI_VERSION).toBe(pkg.version);
    expect(program.version()).toBe(pkg.version);
  });
});

describe('parseScopes', () => {
  it('defaults to read,write', () => {
    expect(parseScopes(undefined)).toEqual(['read', 'write']);
  });

  it('accepts comma and space separators and dedupes', () => {
    expect(parseScopes('read, appetite:read read')).toEqual(['read', 'appetite:read']);
  });

  it('rejects an unknown scope', () => {
    expect(() => parseScopes('read,superuser')).toThrow(/Unknown scope\(s\): superuser/);
  });

  it('accepts claims:write (the server allows it only from a portal session)', () => {
    expect(parseScopes('read,claims:write')).toEqual(['read', 'claims:write']);
  });
});

describe('parseExpiresInDays', () => {
  it('omitted stays undefined, so the server applies its 90-day default', () => {
    expect(parseExpiresInDays(undefined)).toBeUndefined();
  });

  it('passes "never" through for a read-only key', () => {
    expect(parseExpiresInDays('never')).toBe('never');
    expect(parseExpiresInDays(' Never ')).toBe('never');
  });

  it('parses a day count', () => {
    expect(parseExpiresInDays('30')).toBe(30);
  });
});

describe('buildMatchInput', () => {
  it('uppercases state, splits lists, and parses numbers', () => {
    expect(buildMatchInput({
      state: 'ca',
      industry: 'bakery',
      coverage: 'general_liability, workers_comp',
      revenue: '250000',
      top: '5',
    })).toMatchObject({
      state: 'CA',
      industry: 'bakery',
      coverageTypes: ['general_liability', 'workers_comp'],
      annualRevenue: 250000,
      topK: 5,
    });
  });

  it('drops a non-numeric amount instead of sending NaN', () => {
    expect(buildMatchInput({ state: 'TX', industry: 'x', payroll: 'lots' }).annualPayroll).toBeUndefined();
  });
});

describe('buildLeadInput', () => {
  it('omits the address when no address flag is given', () => {
    const input = buildLeadInput({ name: 'Riverbend', email: 'a@b.co', state: 'tx' });
    expect(input.address).toBeUndefined();
    expect(input.state).toBe('TX');
  });

  it('builds the address and falls back to --state', () => {
    const input = buildLeadInput({ name: 'R', email: 'a@b.co', state: 'tx', street: '1 Main', city: 'Austin', zip: '78701' });
    expect(input.address).toEqual({ street: '1 Main', suite: undefined, city: 'Austin', state: 'TX', zip: '78701' });
  });
});

describe('isoDay', () => {
  it('formats a UTC date N days back', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    expect(isoDay(0, now)).toBe('2026-09-22');
    expect(isoDay(30, now)).toBe('2026-08-23');
  });
});

describe('ONBOARDING_STATES', () => {
  it('lists the five contract states in order', () => {
    expect(ONBOARDING_STATES).toEqual(['created', 'awaiting_verification', 'documents_pending', 'processing', 'ready']);
  });
});

describe('replacementExpiryDays', () => {
  const now = new Date('2026-09-22T00:00:00Z');

  it('keeps a read-only key with no expiry non-expiring', () => {
    expect(replacementExpiryDays(undefined, now, ['read'])).toBe('never');
    expect(replacementExpiryDays(undefined, now, ['read', 'appetite:read'])).toBe('never');
  });

  it('gives a never-expiring write key the default expiry (the server refuses never)', () => {
    expect(replacementExpiryDays(undefined, now, ['read', 'write'])).toBeUndefined();
    expect(replacementExpiryDays(undefined, now, ['admin'])).toBeUndefined();
    expect(replacementExpiryDays(undefined, now, ['claims:write'])).toBeUndefined();
  });

  it('carries the remaining lifetime, rounded up', () => {
    expect(replacementExpiryDays('2026-10-02T12:00:00Z', now)).toBe(11);
  });

  it('refuses an unreadable expiry instead of dropping it', () => {
    expect(() => replacementExpiryDays('not-a-date', now)).toThrow(/not rotating/);
  });

  it('clamps to the server range', () => {
    expect(replacementExpiryDays('2026-09-01T00:00:00Z', now)).toBe(1);
    expect(replacementExpiryDays('2030-01-01T00:00:00Z', now)).toBe(365);
  });
});

describe('usage daily default window', () => {
  it('covers 30 calendar days inclusive', () => {
    const now = new Date('2026-09-22T12:00:00Z');
    const from = new Date(`${isoDay(29, now)}T00:00:00Z`).getTime();
    const to = new Date(`${isoDay(0, now)}T00:00:00Z`).getTime();
    expect((to - from) / 86_400_000 + 1).toBe(30);
  });
});
