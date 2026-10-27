/**
 * Configuration management for the Delegance CLI
 *
 * Two files:
 *   - the conf store (config.json, mode 0600): base URL, default company,
 *     output format, and a MASKED hint of the key. Never the key itself.
 *   - ~/.delegance/credentials (mode 0600, directory 0700): the API key, and
 *     nothing else.
 *
 * CLI versions before 0.2.0 also wrote the full key into config.json at the
 * default mode. migrateLegacyConfigKey() moves such a key into the
 * credentials file on the next run (spec 2026-09-24-cli-auth-hardening D1).
 */

import Conf from 'conf';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CLI_VERSION } from '../version';

export interface CLIConfig {
  /** Legacy only: older CLIs wrote the full key here. Read by the migration, never written. */
  apiKey?: string;
  /** Masked key for display: prefix plus the last 4 characters. */
  apiKeyHint?: string;
  /** Last known expiry of the stored key (ISO), from login, refresh, or status. */
  apiKeyExpiresAt?: string;
  baseUrl?: string;
  defaultCompanyId?: string;
  outputFormat?: 'table' | 'json' | 'yaml';
}

const CONFIG_DIR = path.join(os.homedir(), '.delegance');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'credentials');

/** A full key, as opposed to a masked hint. Mirrors the SDK's key format. */
export const API_KEY_REGEX = /^dlg_[a-zA-Z0-9]{8}_sk_[a-zA-Z0-9]{32}$/;

/**
 * Canonical default API origin (WS0/WS1 shared constant; mirrors
 * DEFAULT_BASE_URL in sdk/src/utils/http.ts, the SDK-package source of
 * truth). The prod portal is the default; DELEGANCE_BASE_URL or
 * `config set-profile --url` overrides it.
 */
export const DEFAULT_BASE_URL = 'https://portal.delegancebrokerage.com';

// Create config store
const config = new Conf<CLIConfig>({
  projectName: 'delegance',
  projectVersion: CLI_VERSION,
  // Owner-only, even though the key no longer lives here.
  configFileMode: 0o600,
  defaults: {
    baseUrl: DEFAULT_BASE_URL,
    outputFormat: 'table'
  }
});

/**
 * Get the config store instance
 */
export function getConfig(): Conf<CLIConfig> {
  return config;
}

/**
 * Get a configuration value by key
 */
export function getConfigValue<K extends keyof CLIConfig>(key: K): CLIConfig[K] {
  return config.get(key);
}

/**
 * Set a configuration value
 */
export function setConfig<K extends keyof CLIConfig>(key: K, value: CLIConfig[K]): void {
  config.set(key, value);
}

/**
 * Delete a configuration value
 */
export function deleteConfig<K extends keyof CLIConfig>(key: K): void {
  config.delete(key);
}

/**
 * Get all configuration values
 */
export function getAllConfig(): CLIConfig {
  return config.store;
}

/**
 * Clear all configuration
 */
export function clearConfig(): void {
  config.clear();
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  return config.path;
}

/** Path of the credentials file (for messages; never print its contents). */
export function getCredentialsPath(): string {
  return CREDENTIALS_FILE;
}

/**
 * Write the credentials file atomically at 0600: a fresh O_EXCL temp file in
 * the 0700 directory, renamed into place. Refuses a planted symlink.
 */
function writeCredentialsFile(apiKey: string): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch {
    // Not ours to fix (shared home); the file itself is still 0600.
  }
  try {
    if (fs.lstatSync(CREDENTIALS_FILE).isSymbolicLink()) {
      throw new Error(`${CREDENTIALS_FILE} is a symlink; refusing to write the API key there`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const tmp = `${CREDENTIALS_FILE}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeSync(fd, apiKey);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, CREDENTIALS_FILE);
}

function readCredentialsFile(): string | undefined {
  try {
    const key = fs.readFileSync(CREDENTIALS_FILE, 'utf-8').trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Store the API key: the key goes ONLY to ~/.delegance/credentials (0600);
 * config.json keeps a masked hint and the expiry when known.
 */
export function storeApiKey(apiKey: string, meta: { expiresAt?: string | null } = {}): void {
  writeCredentialsFile(apiKey);
  config.delete('apiKey');
  config.set('apiKeyHint', maskApiKey(apiKey));
  if (meta.expiresAt) config.set('apiKeyExpiresAt', meta.expiresAt);
  else config.delete('apiKeyExpiresAt');
}

/** Record a newer expiry for the stored key (after refresh or a status read). */
export function setStoredKeyExpiry(expiresAt: string | null): void {
  if (expiresAt) config.set('apiKeyExpiresAt', expiresAt);
  else config.delete('apiKeyExpiresAt');
}

export type LegacyKeyMigration = 'none' | 'moved' | 'dropped_duplicate' | 'failed';

/**
 * Move a full key that an older CLI left in config.json into the credentials
 * file, and leave config.json with a masked hint. Runs before every command.
 * When a credentials file already exists it wins, because getApiKey always
 * read it first. Also tightens a credentials file wider than 0600. Prints one
 * line to stderr naming the files, never the key.
 */
export function migrateLegacyConfigKey(log: (line: string) => void = (l) => process.stderr.write(`${l}\n`)): LegacyKeyMigration {
  try {
    if (fs.existsSync(CREDENTIALS_FILE) && (fs.statSync(CREDENTIALS_FILE).mode & 0o077) !== 0) {
      fs.chmodSync(CREDENTIALS_FILE, 0o600);
    }
  } catch {
    // Best effort; reading still works.
  }

  const legacy = config.get('apiKey');
  if (typeof legacy !== 'string' || !legacy) return 'none';
  if (!API_KEY_REGEX.test(legacy.trim())) {
    // A masked or garbage value: nothing to protect, just drop it.
    config.delete('apiKey');
    return 'none';
  }

  const existing = readCredentialsFile();
  if (existing) {
    config.delete('apiKey');
    config.set('apiKeyHint', maskApiKey(existing));
    log(`Removed a plaintext copy of your API key from ${config.path}; the key in ${CREDENTIALS_FILE} is unchanged.`);
    return 'dropped_duplicate';
  }
  try {
    writeCredentialsFile(legacy.trim());
  } catch (err) {
    log(`Your API key is still stored in ${config.path}. Could not move it to ${CREDENTIALS_FILE}: ${(err as Error).message}`);
    return 'failed';
  }
  config.delete('apiKey');
  config.set('apiKeyHint', maskApiKey(legacy.trim()));
  log(`Moved your API key from ${config.path} into ${CREDENTIALS_FILE} (readable only by you).`);
  return 'moved';
}

/**
 * Get stored API key
 */
export function getApiKey(): string | undefined {
  // First check environment variable
  if (process.env.DELEGANCE_API_KEY) {
    return process.env.DELEGANCE_API_KEY;
  }

  // Then the credentials file
  const stored = readCredentialsFile();
  if (stored) return stored;

  // Last, a legacy config.json copy the migration could not move (it warned).
  const legacy = config.get('apiKey');
  return typeof legacy === 'string' && API_KEY_REGEX.test(legacy.trim()) ? legacy.trim() : undefined;
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getApiKey();
}

/**
 * Clear stored credentials
 */
export function clearCredentials(): void {
  config.delete('apiKey');
  config.delete('apiKeyHint');
  config.delete('apiKeyExpiresAt');

  if (fs.existsSync(CREDENTIALS_FILE)) {
    fs.unlinkSync(CREDENTIALS_FILE);
  }
}

/**
 * Get base URL for API calls
 */
export function getBaseUrl(): string {
  return process.env.DELEGANCE_BASE_URL || config.get('baseUrl') || DEFAULT_BASE_URL;
}

/**
 * Mask an API key for display
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 20) {
    return '***';
  }
  
  // Show prefix (dlg_xxxxxxxx) and last 4 chars
  const prefix = apiKey.substring(0, 12);
  const suffix = apiKey.substring(apiKey.length - 4);
  return `${prefix}...${suffix}`;
}
