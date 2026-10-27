/**
 * Authentication commands for the Delegance CLI
 *
 *   auth login            browser login: approve this terminal in the portal (default)
 *   auth login --key K    store a key created in the portal
 *   auth login --paste    prompt for a key instead of opening the browser
 *   auth status           the stored key, where it lives, and when it expires
 *   auth refresh          extend a CLI key to 90 days from now
 *   auth logout / whoami
 *
 * Keys live only in ~/.delegance/credentials (0600); config.json keeps a
 * masked hint (spec 2026-09-24-cli-auth-hardening).
 */

import * as os from 'os';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { DeleganceClient, DeleganceError, createDeviceLogin, newDeviceSecret, type ApiKeyInfo } from '@delegance/sdk';
import {
  API_KEY_REGEX,
  storeApiKey,
  getApiKey,
  clearCredentials,
  isAuthenticated,
  maskApiKey,
  getBaseUrl,
  getConfigPath,
  getConfigValue,
  getCredentialsPath,
  setConfig,
  setStoredKeyExpiry,
} from '../utils/config';
import { PORTAL_URL, failWith } from '../utils/client';
import { openInBrowser } from '../utils/browser';
import { success, error, info, warn, keyValue, header } from '../utils/output';
import { storeOrPrintKey } from './signup';
import { CLI_CLIENT_HEADERS } from '../version';
import { cliInvocation } from '../utils/invocation';

const KEY_FORMAT_HINT = 'Expected format: dlg_xxxxxxxx_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

/** "alex-mbp (alex)": what the portal shows the approver. Server-side sanitized too. */
export function defaultDeviceName(): string {
  let user = '';
  try {
    user = os.userInfo().username;
  } catch {
    // No passwd entry (containers): the host name alone is fine.
  }
  const host = os.hostname() || 'terminal';
  return (user ? `${host} (${user})` : host).slice(0, 64);
}

/** "Dec 23, 2026 (in 90 days)", "expired", or "never". Exported for tests. */
export function describeExpiry(expiresAt: string | null | undefined, now: Date = new Date()): string {
  if (!expiresAt) return 'Never';
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return 'Unknown';
  const date = new Date(at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const days = Math.ceil((at - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return `${date} (expired)`;
  return `${date} (in ${days} day${days === 1 ? '' : 's'})`;
}

/** What to tell the user when the device login stops. Exported for tests. */
export function deviceLoginRefusal(err: unknown): string | null {
  if (!(err instanceof DeleganceError)) return null;
  switch (err.reason) {
    case 'access_denied':
      return 'The request was denied in the portal. Nothing was stored.';
    case 'expired':
      return `The code expired before it was approved. Run "${cliInvocation()} auth login" again.`;
    case 'already_collected':
      return `This login was already used. Run "${cliInvocation()} auth login" again.`;
    default:
      return null;
  }
}

function notAvailable(err: unknown): boolean {
  return err instanceof DeleganceError && (err.statusCode === 404 || err.reason === 'not_available');
}

function pasteFallbackHint(): void {
  info(`Create a key at ${PORTAL_URL}/portal/settings/api-keys, then run "${cliInvocation()} auth login --key <key>".`);
}

/** Best-effort expiry read for a key that was just stored. */
async function readKeyInfo(apiKey: string, timeoutMs = 5000): Promise<ApiKeyInfo | null> {
  try {
    const client = new DeleganceClient({ apiKey, baseUrl: getBaseUrl(), headers: CLI_CLIENT_HEADERS, timeout: timeoutMs, retries: 0 });
    return await client.auth.keyInfo();
  } catch {
    return null;
  }
}

async function loginWithKey(apiKey: string, skipVerify: boolean): Promise<void> {
  if (!API_KEY_REGEX.test(apiKey)) {
    error('Invalid API key format');
    info(KEY_FORMAT_HINT);
    process.exit(1);
  }

  if (skipVerify) {
    storeApiKey(apiKey);
    success('API key stored (verification skipped)');
    info(`API key stored in ${getCredentialsPath()}`);
    warn('Key will be verified on first API call');
    return;
  }

  const spinner = ora('Verifying API key...').start();
  try {
    const client = new DeleganceClient({ apiKey, baseUrl: getBaseUrl(), headers: CLI_CLIENT_HEADERS });
    const isValid = await client.verifyApiKey();
    if (!isValid) {
      spinner.fail('API key verification failed');
      error('The API key is invalid or expired');
      info('Use --skip-verify to store anyway');
      process.exit(1);
    }
    const keyInfo = await readKeyInfo(apiKey);
    storeApiKey(apiKey, { expiresAt: keyInfo?.expiresAt ?? null });
    spinner.succeed('API key verified');
    success('Successfully authenticated!');
    info(`API key stored in ${getCredentialsPath()}`);
  } catch (err) {
    spinner.fail('Failed to verify API key');
    error('Could not connect to Delegance API', (err as Error).message);
    info('Use --skip-verify to store anyway, or check DELEGANCE_BASE_URL');
    process.exit(1);
  }
}

async function loginWithBrowser(openBrowser: boolean): Promise<void> {
  const login = createDeviceLogin({ baseUrl: getBaseUrl(), headers: CLI_CLIENT_HEADERS });
  const device = newDeviceSecret();

  let start;
  try {
    start = await login.start({ deviceSecretHash: device.hash, deviceName: defaultDeviceName() });
  } catch (err) {
    if (notAvailable(err)) {
      error('Browser login is not available on this server yet.');
      pasteFallbackHint();
      process.exit(1);
    }
    failWith('Could not start the login', err);
  }

  console.log();
  info('Approve this terminal in the Delegance portal:');
  console.log(`  ${start.verificationUriComplete}`);
  console.log();
  info(`Check that the page shows this code: ${start.userCode}`);
  info('If the portal asks you to sign in first, open the link again after you sign in.');
  if (openBrowser && process.stdout.isTTY) openInBrowser(start.verificationUriComplete);
  console.log();

  const spinner = ora('Waiting for approval in the portal (Ctrl-C to cancel)...').start();
  try {
    const expiresIn = Date.parse(start.expiresAt) - Date.now();
    const result = await login.waitForKey(start.loginId, device.secret, {
      // The code waits 10 minutes; an approval then waits 5 more for this poll.
      timeoutMs: Math.max(60_000, (Number.isFinite(expiresIn) ? expiresIn : 600_000) + 60_000),
      intervalMs: Math.max(1, start.interval || 5) * 1000,
    });
    if (result.status !== 'ready') {
      spinner.fail('The code expired before it was approved.');
      info(`Run "${cliInvocation()} auth login" again.`);
      process.exit(1);
    }
    spinner.stop();
    const stored = storeOrPrintKey(result.apiKey, (k) => storeApiKey(k, { expiresAt: result.expiresAt }));
    setConfig('defaultCompanyId', result.companyId);
    if (stored) success(`Signed in. API key ${maskApiKey(result.apiKey)} saved to ${getCredentialsPath()}`);
    keyValue({
      Company: result.companyId,
      Access: result.scopes.join(', ') || 'read',
      Expires: describeExpiry(result.expiresAt),
    });
    info('The key stays valid while you use it; 90 days without use and it expires.');
  } catch (err) {
    spinner.stop();
    const why = deviceLoginRefusal(err);
    if (why) {
      error(why);
      process.exit(1);
    }
    failWith('Login failed', err);
  }
}

export function createAuthCommand(): Command {
  const auth = new Command('auth')
    .description('Manage authentication');

  auth
    .command('login')
    .description('Sign in: approve this terminal in the portal, or store an API key')
    .option('-k, --key <apiKey>', 'Store this API key instead of signing in with the browser')
    .option('--paste', 'Prompt for an API key instead of signing in with the browser')
    .option('--no-browser', 'Print the approval link without opening a browser')
    .option('--skip-verify', 'With --key or --paste: store without verification (useful when API is not reachable)')
    .action(async (options) => {
      try {
        if (options.key) {
          await loginWithKey(String(options.key).trim(), Boolean(options.skipVerify));
          return;
        }
        if (options.paste) {
          const answers = await inquirer.prompt([
            {
              type: 'password',
              name: 'apiKey',
              message: 'Enter your API key:',
              mask: '*',
              validate: (input: string) => {
                if (!input) return 'API key is required';
                if (!API_KEY_REGEX.test(input)) return `Invalid API key format. ${KEY_FORMAT_HINT}`;
                return true;
              },
            },
          ]);
          await loginWithKey(answers.apiKey, Boolean(options.skipVerify));
          return;
        }
        await loginWithBrowser(options.browser !== false);
      } catch (err) {
        failWith('Authentication failed', err);
      }
    });

  auth
    .command('status')
    .description('Show the stored key, where it lives, and when it expires')
    .action(async () => {
      header('Authentication Status');

      if (!isAuthenticated()) {
        warn('Not authenticated');
        info(`Run "${cliInvocation()} auth login" to sign in, or "${cliInvocation()} signup" to create an account`);
        return;
      }

      const apiKey = getApiKey() || '';
      const fromEnv = Boolean(process.env.DELEGANCE_API_KEY);
      const cached = fromEnv ? undefined : getConfigValue('apiKeyExpiresAt');
      let expiryLine = cached ? `${describeExpiry(cached)} (last known)` : 'Unknown (could not reach the server)';
      let origin: string | null = null;
      let refused: string | null = null;

      try {
        const client = new DeleganceClient({ apiKey, baseUrl: getBaseUrl(), headers: CLI_CLIENT_HEADERS, timeout: 5000, retries: 0 });
        const keyInfo = await client.auth.keyInfo();
        origin = keyInfo.origin;
        expiryLine = describeExpiry(keyInfo.expiresAt);
        if (!fromEnv) setStoredKeyExpiry(keyInfo.expiresAt);
      } catch (err) {
        // A 401 means the key can no longer make calls; anything else (offline,
        // timeout, a 5xx) leaves the cached expiry on screen.
        if (err instanceof DeleganceError && err.statusCode === 401) {
          refused = err.reason === 'key_expired'
            ? 'Your API key expired'
            : err.reason === 'key_membership_revoked'
              ? 'Your API key was revoked: its user is no longer an active member of the company'
              : 'Your API key was rejected by the server';
          expiryLine = err.reason === 'key_expired' ? 'Expired' : 'Not valid';
        }
      }

      if (refused) {
        warn(refused);
        info(`Run "${cliInvocation()} auth login" to sign in again.`);
      } else {
        success('Authenticated');
      }
      console.log();
      keyValue({
        'API Key': maskApiKey(apiKey),
        'Source': fromEnv ? 'DELEGANCE_API_KEY' : getCredentialsPath(),
        ...(origin ? { 'Created by': origin === 'cli_login' ? 'browser login' : origin === 'cli_signup' ? 'CLI signup' : origin } : {}),
        'Expires': expiryLine,
        'Base URL': getBaseUrl(),
        'Config File': getConfigPath(),
      });
    });

  auth
    .command('refresh')
    .description('Extend a CLI key to 90 days from now')
    .action(async () => {
      const apiKey = getApiKey();
      if (!apiKey) {
        error('Not authenticated');
        info(`Run "${cliInvocation()} auth login" to sign in`);
        process.exit(1);
      }
      const spinner = ora('Refreshing your key...').start();
      try {
        const client = new DeleganceClient({ apiKey, baseUrl: getBaseUrl(), headers: CLI_CLIENT_HEADERS });
        const { expiresAt } = await client.auth.refresh();
        if (!process.env.DELEGANCE_API_KEY) setStoredKeyExpiry(expiresAt);
        spinner.succeed(`Key refreshed. Expires ${describeExpiry(expiresAt)}.`);
      } catch (err) {
        spinner.stop();
        if (err instanceof DeleganceError && err.reason === 'not_refreshable') {
          info('This key came from the portal and keeps the expiry it was created with. Nothing changed.');
          return;
        }
        if (notAvailable(err)) {
          error('Key refresh is not available on this server yet.');
          process.exit(1);
        }
        failWith('Could not refresh the key', err);
      }
    });

  auth
    .command('logout')
    .description('Remove stored credentials')
    .option('-f, --force', 'Skip confirmation')
    .action(async (options) => {
      if (!isAuthenticated()) {
        info('Not currently authenticated');
        return;
      }

      if (!options.force) {
        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to remove your credentials?',
            default: false
          }
        ]);

        if (!confirm) {
          info('Logout cancelled');
          return;
        }
      }

      clearCredentials();
      success('Successfully logged out');
      info('API key removed from local storage');
    });

  auth
    .command('whoami')
    .description('Show current authenticated identity')
    .action(async () => {
      if (!isAuthenticated()) {
        error('Not authenticated');
        info(`Run "${cliInvocation()} auth login" to authenticate`);
        process.exit(1);
      }

      const apiKey = getApiKey();
      if (!apiKey) {
        error('No API key found');
        process.exit(1);
      }

      const spinner = ora('Fetching account info...').start();

      try {
        const client = new DeleganceClient({
          apiKey,
          baseUrl: getBaseUrl(),
          headers: CLI_CLIENT_HEADERS,
        });

        const companies = await client.companies.list();

        spinner.succeed('Account info retrieved');
        console.log();

        if (companies.length > 0) {
          const company = companies[0];
          keyValue({
            'Company': company.name,
            'Company ID': company.id,
            'Industry': company.industry,
            'Contact': company.contactEmail,
            'API Key': maskApiKey(apiKey)
          });
        } else {
          warn('No company found for this API key');
        }

      } catch (err) {
        spinner.fail('Failed to fetch account info');
        failWith('API request failed', err);
      }
    });

  return auth;
}
