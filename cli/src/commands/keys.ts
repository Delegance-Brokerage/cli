/**
 * API key commands for the Delegance CLI
 *
 * create and list work with an API key that carries `admin` (create) or
 * `read` (list). Revoking needs a portal session today, and the server has
 * no rotate route, so `rotate` creates a replacement key with the same
 * scopes and tells you where to revoke the old one.
 */

import { Command } from 'commander';
import ora from 'ora';
import { randomUUID } from 'crypto';
import {
  API_KEY_SCOPES,
  AuthenticationError,
  type ApiKeyScope,
} from '@delegance/sdk';
import { getClient, failWith, PORTAL_URL } from '../utils/client';
import { success, error, info, warn, table, json, keyValue, formatDate } from '../utils/output';
import { cliInvocation } from '../utils/invocation';

export const KEYS_PORTAL_URL = `${PORTAL_URL}/portal/settings/api-keys`;

/** Parse a comma or space separated scope list and reject unknown names. */
/** "never" passes through (the server allows it only for a read-only key); anything else is a day count. */
export function parseExpiresInDays(raw: string | undefined): number | 'never' | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw.trim().toLowerCase() === 'never') return 'never';
  return parseInt(raw, 10);
}

export function parseScopes(raw: string | string[] | undefined): ApiKeyScope[] {
  const parts = (Array.isArray(raw) ? raw : [raw ?? 'read,write'])
    .flatMap(p => p.split(/[\s,]+/))
    .map(p => p.trim())
    .filter(Boolean);
  const unknown = parts.filter(p => !(API_KEY_SCOPES as readonly string[]).includes(p));
  if (unknown.length > 0) {
    throw new Error(`Unknown scope(s): ${unknown.join(', ')}. Allowed: ${API_KEY_SCOPES.join(', ')}`);
  }
  return Array.from(new Set(parts)) as ApiKeyScope[];
}

/** Scopes that force a key to expire (the server refuses 'never' for them). */
const EXPIRING_SCOPES = new Set(['write', 'admin', 'claims:write']);

export function isReadOnlyScopeSet(scopes: readonly string[]): boolean {
  return !scopes.some(s => EXPIRING_SCOPES.has(s));
}

/**
 * Keep an expiring key expiring: the replacement lives as long as the old key
 * had left, clamped to the server's 1-365 day range. An expiry that cannot be
 * parsed throws, so rotation stops instead of widening the lifetime.
 *
 * A key with no expiry: a read-only key stays non-expiring ('never'). A key
 * with write, admin or claims:write can no longer be minted without an expiry,
 * so it returns undefined (the server's 90-day default) and the caller says so.
 */
export function replacementExpiryDays(
  expiresAt: string | undefined,
  now: Date = new Date(),
  scopes: readonly string[] = [],
): number | 'never' | undefined {
  if (!expiresAt) return isReadOnlyScopeSet(scopes) ? 'never' : undefined;
  const ms = new Date(expiresAt).getTime() - now.getTime();
  // Fail closed: an unreadable expiry must never become a key that never expires.
  if (!Number.isFinite(ms)) throw new Error(`Cannot read the old key's expiry "${expiresAt}"; not rotating`);
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return Math.min(365, Math.max(1, days));
}

function printCreatedKey(created: { id: string; name: string; key: string; scopes: string[]; expiresAt?: string }): void {
  success('API key created');
  console.log();
  keyValue({
    'ID': created.id,
    'Name': created.name,
    'Scopes': created.scopes,
    'Expires': created.expiresAt ? formatDate(created.expiresAt) : 'never'
  });
  console.log();
  warn('Save this key now. It is shown once and cannot be retrieved again:');
  console.log(`  ${created.key}`);
}

export function createKeysCommand(): Command {
  const keys = new Command('keys')
    .alias('api-keys')
    .description('Manage API keys');

  keys
    .command('list')
    .alias('ls')
    .description('List API keys for your company')
    .option('-l, --limit <n>', 'Maximum results', '50')
    .option('--cursor <cursor>', 'Page cursor from a previous list')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const client = getClient();
      const spinner = ora('Fetching API keys...').start();
      try {
        const { data, pagination } = await client.apiKeys.list({
          limit: parseInt(options.limit),
          cursor: options.cursor
        });
        spinner.succeed(`Found ${data.length} keys`);
        if (options.json) {
          json({ data, pagination });
          return;
        }
        if (data.length === 0) return;
        console.log();
        table(
          ['ID', 'Name', 'Prefix', 'Scopes', 'Active', 'Last used', 'Expires'],
          data.map(k => [
            k.id,
            k.name,
            k.prefix,
            k.scopes.join(','),
            k.isActive ? 'yes' : 'no',
            k.lastUsedAt ? formatDate(k.lastUsedAt) : '-',
            k.expiresAt ? formatDate(k.expiresAt) : '-'
          ])
        );
        if (pagination?.hasMore && pagination.nextCursor) {
          info(`More keys: ${cliInvocation()} keys list --cursor ${pagination.nextCursor}`);
        }
      } catch (err) {
        spinner.fail('Failed to list API keys');
        failWith('API error', err);
      }
    });

  keys
    .command('create <name>')
    .description('Create an API key (needs a key with the admin scope)')
    .option('-s, --scopes <scopes>', `Comma-separated scopes (${API_KEY_SCOPES.join(', ')})`, 'read,write')
    .option('-e, --expires-in-days <days>', 'Expire the key after N days (1-365; default 90), or "never" for a read-only key')
    .option('--json', 'Output as JSON')
    .action(async (name: string, options) => {
      let scopes: ApiKeyScope[];
      try {
        scopes = parseScopes(options.scopes);
      } catch (err) {
        error((err as Error).message);
        process.exit(1);
      }

      const client = getClient();
      const spinner = ora('Creating API key...').start();
      try {
        const created = await client.apiKeys.create(
          {
            name,
            scopes,
            expiresInDays: parseExpiresInDays(options.expiresInDays)
          },
          { idempotencyKey: randomUUID() }
        );
        spinner.stop();
        if (options.json) {
          json(created);
        } else {
          printCreatedKey(created);
        }
      } catch (err) {
        spinner.fail('Failed to create API key');
        failWith('API error', err);
      }
    });

  keys
    .command('rotate <keyId>')
    .description('Create a replacement key with the same name and scopes')
    .option('--json', 'Output as JSON')
    .action(async (keyId: string, options) => {
      const client = getClient();
      const spinner = ora('Looking up key...').start();
      try {
        // Walk every page: the key may not be on the first one.
        let cursor: string | undefined;
        let current;
        do {
          const page = await client.apiKeys.list({ limit: 100, cursor });
          current = page.data.find(k => k.id === keyId);
          cursor = page.pagination?.hasMore ? page.pagination.nextCursor : undefined;
        } while (!current && cursor);

        if (!current) {
          spinner.fail(`No API key with id ${keyId}`);
          process.exit(1);
        }

        spinner.text = 'Creating replacement key...';
        const created = await client.apiKeys.create(
          {
            name: `${current.name} (rotated)`,
            scopes: current.scopes as ApiKeyScope[],
            expiresInDays: replacementExpiryDays(current.expiresAt, new Date(), current.scopes)
          },
          { idempotencyKey: randomUUID() }
        );
        spinner.stop();

        if (options.json) {
          json({ newKey: created, oldKeyId: keyId, oldKeyStillActive: true });
          return;
        }
        printCreatedKey(created);
        console.log();
        if (!current.expiresAt && !isReadOnlyScopeSet(current.scopes)) {
          warn('The old key never expired. Keys that can write must expire now, so the new key lasts 90 days.');
        }
        warn(`The old key ${current.prefix} is still active.`);
        info(`Switch your integrations to the new key, then revoke the old one at ${KEYS_PORTAL_URL}`);
      } catch (err) {
        spinner.fail('Failed to rotate API key');
        failWith('API error', err);
      }
    });

  keys
    .command('revoke <keyId>')
    .description('Revoke an API key')
    .action(async (keyId: string) => {
      const client = getClient();
      const spinner = ora('Revoking API key...').start();
      try {
        await client.apiKeys.revoke(keyId);
        spinner.succeed('API key revoked');
      } catch (err) {
        spinner.fail('Failed to revoke API key');
        // The revoke route accepts a portal session only, so an API key gets 401.
        if (err instanceof AuthenticationError) {
          error('Revoking a key needs a signed-in portal session today');
          info(`Revoke it at ${KEYS_PORTAL_URL}`);
          process.exit(1);
        }
        failWith('API error', err);
      }
    });

  return keys;
}
