/**
 * The polling loop shared by the device-secret exchanges: signup collect
 * (`SignupModule.waitForKey`) and browser login (`DeviceLoginModule.waitForKey`).
 *
 * Polls until `poll` returns anything other than `{ status: 'pending' }` or the
 * timeout passes. A 429 is not an answer: the loop waits the server's
 * Retry-After (bounded by the time left) and keeps polling, instead of
 * throwing away a signup or login whose human has not clicked yet.
 *
 * A poll is a status check sent as a POST, so the HTTP client sends it once
 * and reports a timeout or dropped connection as OutcomeUnknownError. Here
 * that is not an answer either: the next poll is the retry. The same holds
 * for a transient 5xx. A 4xx, a 501, or a 503 `not_available` still ends
 * the wait.
 */
import { DeleganceError, OutcomeUnknownError, RateLimitError } from '../types';
import { isRetryableStatus } from './http';

export interface PollOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onPoll?: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A failure that says nothing about the login or signup: poll again. */
function isTransientPollFailure(err: unknown): boolean {
  if (err instanceof OutcomeUnknownError) return true;
  return err instanceof DeleganceError && isRetryableStatus(err.statusCode) && err.reason !== 'not_available';
}

export async function pollUntilReady<T extends { status: string }>(
  poll: () => Promise<T>,
  opts: PollOptions = {},
): Promise<T | { status: 'pending' }> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let wait = intervalMs;
    try {
      const r = await poll();
      if (r.status !== 'pending') return r;
    } catch (err) {
      if (err instanceof RateLimitError) {
        wait = Math.max(intervalMs, (err.retryAfter ?? 60) * 1000);
      } else if (!isTransientPollFailure(err)) {
        throw err;
      }
    }
    opts.onPoll?.();
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { status: 'pending' };
    await sleep(Math.min(wait, remaining));
  }
}
