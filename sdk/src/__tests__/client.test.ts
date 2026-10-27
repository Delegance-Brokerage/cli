import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeleganceClient, createClientFromEnv } from '../client';

const VALID_KEY = 'dlg_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345';

describe('DeleganceClient', () => {
  describe('constructor', () => {
    it('creates client with valid API key', () => {
      const client = new DeleganceClient({ apiKey: VALID_KEY });
      expect(client).toBeInstanceOf(DeleganceClient);
      expect(client.companies).toBeDefined();
      expect(client.documents).toBeDefined();
      expect(client.chat).toBeDefined();
      expect(client.quotes).toBeDefined();
      expect(client.policies).toBeDefined();
      expect(client.coi).toBeDefined();
      expect(client.sov).toBeDefined();
    });

    it('throws if API key is missing', () => {
      expect(() => new DeleganceClient({ apiKey: '' }))
        .toThrow('API key is required');
    });

    it('throws if API key has invalid format', () => {
      expect(() => new DeleganceClient({ apiKey: 'bad-key' }))
        .toThrow('Invalid API key format');
    });

    it('rejects key with wrong prefix', () => {
      expect(() => new DeleganceClient({ apiKey: 'xxx_abcdefgh_sk_abcdefghijklmnopqrstuvwxyz012345' }))
        .toThrow('Invalid API key format');
    });

    it('rejects key with wrong length', () => {
      expect(() => new DeleganceClient({ apiKey: 'dlg_abc_sk_abc' }))
        .toThrow('Invalid API key format');
    });
  });

  describe('version', () => {
    it('returns SDK version', () => {
      expect(DeleganceClient.version).toBe('0.3.1');
    });
  });

  describe('verifyApiKey', () => {
    it('returns true when companies.list succeeds', async () => {
      const client = new DeleganceClient({ apiKey: VALID_KEY });
      vi.spyOn(client.companies, 'list').mockResolvedValue([]);
      expect(await client.verifyApiKey()).toBe(true);
    });

    it('returns false when companies.list throws', async () => {
      const client = new DeleganceClient({ apiKey: VALID_KEY });
      vi.spyOn(client.companies, 'list').mockRejectedValue(new Error('Unauthorized'));
      expect(await client.verifyApiKey()).toBe(false);
    });
  });
});

describe('createClientFromEnv', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...original };
  });

  afterEach(() => {
    process.env = original;
  });

  it('creates client from DELEGANCE_API_KEY', () => {
    process.env.DELEGANCE_API_KEY = VALID_KEY;
    const client = createClientFromEnv();
    expect(client).toBeInstanceOf(DeleganceClient);
  });

  it('uses DELEGANCE_BASE_URL if set', () => {
    process.env.DELEGANCE_API_KEY = VALID_KEY;
    process.env.DELEGANCE_BASE_URL = 'https://custom.api.com';
    const client = createClientFromEnv();
    expect(client).toBeInstanceOf(DeleganceClient);
  });

  it('throws if DELEGANCE_API_KEY is not set', () => {
    delete process.env.DELEGANCE_API_KEY;
    expect(() => createClientFromEnv())
      .toThrow('DELEGANCE_API_KEY environment variable is required');
  });
});
