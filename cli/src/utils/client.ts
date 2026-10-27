/**
 * Shared SDK client + error reporting for CLI commands.
 */

import {
  DeleganceClient,
  DeleganceError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  NotImplementedError,
  RateLimitError,
} from '@delegance/sdk';
import { getApiKey, getBaseUrl, getConfigValue } from './config';
import { error, info } from './output';
import { noteTraceId } from './last-command';
import { cliInvocation } from './invocation';
import { CLI_CLIENT_HEADERS } from '../version';
import { isPromptExit, supportLine } from '../support';

export const PORTAL_URL = 'https://portal.delegancebrokerage.com';

/** Build an authenticated client, or exit with a login hint. */
export function getClient(): DeleganceClient {
  const apiKey = getApiKey();
  if (!apiKey) {
    error('Not authenticated');
    info(`New to Delegance? Run "${cliInvocation()} signup" to create an account.`);
    info(`Have an API key? Run "${cliInvocation()} auth login", or set DELEGANCE_API_KEY.`);
    process.exit(1);
  }

  return new DeleganceClient({
    apiKey,
    baseUrl: getBaseUrl(),
    headers: CLI_CLIENT_HEADERS,
  });
}

/** Resolve --company or the configured default, or exit with a hint. */
export function getCompanyId(options: { company?: string }): string {
  const companyId = options.company || getConfigValue('defaultCompanyId');
  if (!companyId) {
    error('No company specified');
    info(`Use --company <id> or set a default with "${cliInvocation()} company use <id>"`);
    process.exit(1);
  }
  return companyId;
}

/**
 * True when the user cannot fix the failure themselves: a 5xx other than 501,
 * no response at all (a network failure or a timeout), or an error that is
 * not from the API. A 4xx carries its own fix, so it gets no support line.
 */
export function isUnexpectedError(err: unknown): boolean {
  if (err instanceof DeleganceError) return err.statusCode === 0 || (err.statusCode >= 500 && err.statusCode !== 501);
  return true;
}

/**
 * Turn an SDK error into a message a person can act on. Returns the lines
 * to print so tests can assert on them without capturing stdout. `support`
 * is set only for an unexpected error (see isUnexpectedError).
 */
export function describeApiError(err: unknown): { message: string; hint?: string; support?: string } {
  const described = describeKnownError(err);
  return isUnexpectedError(err) ? { ...described, support: supportLine() } : described;
}

function describeKnownError(err: unknown): { message: string; hint?: string } {
  const traceSuffix = err instanceof DeleganceError && err.traceId ? ` (trace ${err.traceId})` : '';

  if (err instanceof NotImplementedError) {
    return { message: `${err.message}${traceSuffix}`, hint: `This is not available over the API yet. Use the portal: ${PORTAL_URL}` };
  }
  if (err instanceof AuthenticationError) {
    if (err.reason === 'key_expired' || err.reason === 'key_membership_revoked') {
      return { message: `${err.message}${traceSuffix}`, hint: `Run "${cliInvocation()} auth login" to sign in again.` };
    }
    return { message: `${err.message}${traceSuffix}`, hint: `Check your key with "${cliInvocation()} auth status", or log in again.` };
  }
  if (err instanceof ForbiddenError) {
    return { message: `${err.message}${traceSuffix}`, hint: 'Your API key lacks the scope for this command. Create a key with the right scope in the portal.' };
  }
  if (err instanceof RateLimitError) {
    const wait = err.retryAfter ? ` Retry in ${err.retryAfter}s.` : '';
    return { message: `${err.message}${traceSuffix}`, hint: `Rate limited.${wait}` };
  }
  if (err instanceof NotFoundError) {
    return { message: `${err.message}${traceSuffix}` };
  }
  // Read by field, not by class: a CLI may run against an older SDK release
  // that does not export OutcomeUnknownError.
  if (err instanceof Error && (err as { outcome?: unknown }).outcome === 'unknown') {
    return {
      message: err.message,
      hint: `The command may have gone through. Check with the matching list or status command (for example "${cliInvocation()} coi list") before you run it again.`,
    };
  }
  if (err instanceof Error) {
    return { message: `${err.message}${traceSuffix}` };
  }
  return { message: String(err) };
}

/** Print an SDK error with its hint and exit 1. Ctrl+C in a prompt exits 130 with no message. */
export function failWith(label: string, err: unknown): never {
  if (isPromptExit(err)) process.exit(130);
  if (err instanceof DeleganceError) noteTraceId(err.traceId);
  const { message, hint, support } = describeApiError(err);
  error(label, message);
  if (hint) info(hint);
  // stderr, so a --json caller's stdout stays parseable.
  if (support) console.error(support);
  process.exit(1);
}

/** Parse a positive integer flag (milliseconds, counts) or exit with a message. */
export function positiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    error(`${flag} must be a positive whole number, got "${value}"`);
    process.exit(1);
  }
  return n;
}
