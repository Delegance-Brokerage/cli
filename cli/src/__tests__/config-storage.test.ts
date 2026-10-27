/**
 * Key storage against a REAL filesystem (a temp HOME): the key lives only in
 * ~/.delegance/credentials at 0600, config.json holds a masked hint, and a
 * key an older CLI left in config.json moves on the next run
 * (spec 2026-09-24-cli-auth-hardening D1).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const KEY = 'dlg_abcd1234_sk_abcdefghijklmnopqrstuvwxyz012345';
const OTHER = 'dlg_zzzz9999_sk_zyxwvutsrqponmlkjihgfedcba987654';

let home: string;
const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, DELEGANCE_API_KEY: process.env.DELEGANCE_API_KEY };

type ConfigModule = typeof import('../utils/config');

async function load(): Promise<ConfigModule> {
  vi.resetModules();
  return import('../utils/config');
}

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'delegance-cli-home-'));
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, '.config');
  delete process.env.DELEGANCE_API_KEY;
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

describe('storeApiKey', () => {
  it('writes the key only to a 0600 credentials file in a 0700 directory', async () => {
    const cfg = await load();
    cfg.storeApiKey(KEY, { expiresAt: '2026-12-23T00:00:00.000Z' });

    const creds = cfg.getCredentialsPath();
    expect(creds.startsWith(home)).toBe(true);
    expect(fs.readFileSync(creds, 'utf8')).toBe(KEY);
    expect(mode(creds)).toBe(0o600);
    expect(mode(path.dirname(creds))).toBe(0o700);

    const configPath = cfg.getConfigPath();
    const raw = fs.readFileSync(configPath, 'utf8');
    expect(raw).not.toContain(KEY);
    expect(raw).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(readJson(configPath)).toMatchObject({ apiKeyHint: 'dlg_abcd1234...2345', apiKeyExpiresAt: '2026-12-23T00:00:00.000Z' });
    expect(mode(configPath)).toBe(0o600);

    expect(cfg.getApiKey()).toBe(KEY);
  });

  it('replaces an existing key without leaving temp files behind', async () => {
    const cfg = await load();
    cfg.storeApiKey(KEY);
    cfg.storeApiKey(OTHER);
    expect(cfg.getApiKey()).toBe(OTHER);
    expect(fs.readdirSync(path.dirname(cfg.getCredentialsPath()))).toEqual(['credentials']);
  });

  it('refuses to write the key through a planted symlink', async () => {
    const cfg = await load();
    fs.mkdirSync(path.join(home, '.delegance'), { mode: 0o700 });
    const target = path.join(home, 'elsewhere');
    fs.writeFileSync(target, '');
    fs.symlinkSync(target, cfg.getCredentialsPath());
    expect(() => cfg.storeApiKey(KEY)).toThrow(/symlink/);
    expect(fs.readFileSync(target, 'utf8')).toBe('');
  });

  it('clearCredentials removes the key file and the hint', async () => {
    const cfg = await load();
    cfg.storeApiKey(KEY, { expiresAt: '2026-12-23T00:00:00.000Z' });
    cfg.clearCredentials();
    expect(fs.existsSync(cfg.getCredentialsPath())).toBe(false);
    const json = readJson(cfg.getConfigPath());
    expect(json.apiKeyHint).toBeUndefined();
    expect(json.apiKeyExpiresAt).toBeUndefined();
    expect(cfg.getApiKey()).toBeUndefined();
  });
});

describe('migrateLegacyConfigKey', () => {
  async function seedLegacy(cfg: ConfigModule, key: string): Promise<string> {
    const configPath = cfg.getConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: key, baseUrl: 'https://portal.example' }), { mode: 0o644 });
    return configPath;
  }

  it('moves a plaintext key into 0600 credentials and masks config.json, never printing the key', async () => {
    const cfg = await load();
    const configPath = await seedLegacy(cfg, KEY);
    const lines: string[] = [];

    expect(cfg.migrateLegacyConfigKey((l) => lines.push(l))).toBe('moved');

    expect(fs.readFileSync(cfg.getCredentialsPath(), 'utf8')).toBe(KEY);
    expect(mode(cfg.getCredentialsPath())).toBe(0o600);
    const json = readJson(configPath);
    expect(json.apiKey).toBeUndefined();
    expect(json.apiKeyHint).toBe('dlg_abcd1234...2345');
    expect(json.baseUrl).toBe('https://portal.example');
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(lines).toHaveLength(1);
    expect(lines.join('\n')).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(cfg.getApiKey()).toBe(KEY);

    // A second run has nothing to do and says nothing.
    expect(cfg.migrateLegacyConfigKey((l) => lines.push(l))).toBe('none');
    expect(lines).toHaveLength(1);
  });

  it('keeps the credentials file when both hold a key, and drops the config copy', async () => {
    const cfg = await load();
    cfg.storeApiKey(OTHER);
    const configPath = await seedLegacy(cfg, KEY);
    const lines: string[] = [];

    expect(cfg.migrateLegacyConfigKey((l) => lines.push(l))).toBe('dropped_duplicate');
    expect(cfg.getApiKey()).toBe(OTHER);
    expect(readJson(configPath).apiKey).toBeUndefined();
    expect(fs.readFileSync(configPath, 'utf8')).not.toContain(KEY);
    expect(lines.join('\n')).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
    expect(lines.join('\n')).not.toContain('zyxwvutsrqponmlkjihgfedcba987654');
  });

  it('tightens a credentials file an older CLI left wider than 0600', async () => {
    const cfg = await load();
    cfg.storeApiKey(KEY);
    fs.chmodSync(cfg.getCredentialsPath(), 0o644);
    cfg.migrateLegacyConfigKey(() => undefined);
    expect(mode(cfg.getCredentialsPath())).toBe(0o600);
  });

  it('keeps the user signed in when the move fails, and warns without the key', async () => {
    const cfg = await load();
    const configPath = await seedLegacy(cfg, KEY);
    // ~/.delegance is a plain file, so the credentials directory cannot exist.
    fs.writeFileSync(path.join(home, '.delegance'), 'not a directory');
    const lines: string[] = [];

    expect(cfg.migrateLegacyConfigKey((l) => lines.push(l))).toBe('failed');
    expect(readJson(configPath).apiKey).toBe(KEY);
    expect(cfg.getApiKey()).toBe(KEY);
    expect(lines.join('\n')).toContain('Could not move it');
    expect(lines.join('\n')).not.toContain('abcdefghijklmnopqrstuvwxyz012345');
  });

  it('drops a masked or malformed legacy value without writing credentials', async () => {
    const cfg = await load();
    const configPath = await seedLegacy(cfg, 'dlg_abcd1234...2345');
    expect(cfg.migrateLegacyConfigKey(() => undefined)).toBe('none');
    expect(readJson(configPath).apiKey).toBeUndefined();
    expect(fs.existsSync(cfg.getCredentialsPath())).toBe(false);
  });
});
