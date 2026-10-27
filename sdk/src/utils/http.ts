/**
 * HTTP Client utilities for the Delegance SDK
 */

import {
  DeleganceError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ForbiddenError,
  NotImplementedError,
  OutcomeUnknownError,
  type DeleganceClientConfig
} from '../types';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method: HttpMethod;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  /** If true, body is FormData and shouldn't be JSON stringified */
  isFormData?: boolean;
  /**
   * Marks a write as safe to resend. A POST, PUT, PATCH or DELETE is retried
   * only when this is true AND the request carries an Idempotency-Key, and
   * set it only for a route whose server replays the first response for a
   * repeated key. Every other write is sent once. Default false.
   */
  idempotent?: boolean;
}

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout: number;
  retries: number;
  retryDeadlineMs: number;
  headers: Record<string, string>;
}

/** Kept equal to package.json "version"; a unit test fails on drift. */
export const SDK_VERSION = '0.3.1';

/**
 * The API version this SDK was written against, sent as `Delegance-Version`
 * on every request. A response-shape change that is not additive ships under
 * a newer date, and the server keeps serving this shape to clients that send
 * this date.
 */
export const API_VERSION = '2026-10-01';

/**
 * Canonical default API origin (WS0/WS1 shared constant, the SDK-package
 * source of truth; the CLI mirror lives in cli/src/utils/config.ts).
 *
 * Decided for the 0.2.0 publish (2026-09-24): the prod portal is the default
 * host. Callers override it with `baseUrl` or DELEGANCE_BASE_URL. Changing
 * the host is exactly two lines (this constant + the CLI mirror) plus
 * regenerated docs.
 */
export const DEFAULT_BASE_URL = 'https://portal.delegancebrokerage.com';

const DEFAULT_RETRY_DEADLINE_MS = 60_000;

/** Network errors and 5xx other than 501 are worth another attempt. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 && status !== 501;
}

/**
 * Parse a Retry-After value into milliseconds. Accepts delta-seconds ("30")
 * or an HTTP-date ("Wed, 21 Oct 2026 07:28:00 GMT"). Returns undefined for a
 * missing or unreadable value; a date in the past reads as 0.
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(Number(trimmed) * 1000);
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/**
 * A 409 that says the server is still running an earlier request with the
 * same Idempotency-Key. The server has NOT run this copy, so sending the same
 * key again either waits behind the first or replays its answer. Older
 * servers send only `reason: 'in_progress'`.
 */
export function isIdempotencyInProgress(err: DeleganceError): boolean {
  if (err.statusCode !== 409) return false;
  return err.code === 'idempotency_in_progress' || err.reason === 'in_progress' || err.reason === 'idempotency_in_progress';
}

function hasIdempotencyKey(headers: Record<string, string>): boolean {
  return Object.entries(headers).some(
    ([name, value]) => name.toLowerCase() === 'idempotency-key' && typeof value === 'string' && value.trim() !== ''
  );
}

/**
 * A read may always be retried. A write may be retried only when the caller
 * marked it idempotent and it carries a key the server can dedupe on.
 */
export function mayRetry(method: HttpMethod, idempotent: boolean | undefined, headers: Record<string, string>): boolean {
  if (method === 'GET') return true;
  return idempotent === true && hasIdempotencyKey(headers);
}

interface Attempt {
  url: string;
  path: string;
  method: HttpMethod;
  init: RequestInit;
}

export class HttpClient {
  private config: HttpClientConfig;

  constructor(config: DeleganceClientConfig) {
    this.config = {
      baseUrl: (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ''),
      apiKey: config.apiKey,
      timeout: config.timeout || 30000,
      retries: config.retries ?? 3,
      retryDeadlineMs: config.retryDeadlineMs ?? DEFAULT_RETRY_DEADLINE_MS,
      headers: config.headers || {}
    };
  }

  /** Headers every request carries. Caller headers may override them. */
  private baseHeaders(): Record<string, string> {
    return {
      // No key = an unauthenticated call (signup, the key exchange).
      ...(this.config.apiKey ? { 'Authorization': `Bearer ${this.config.apiKey}` } : {}),
      'User-Agent': `delegance-sdk/${SDK_VERSION}`,
      'Delegance-Version': API_VERSION,
      'X-Delegance-Client': `sdk/${SDK_VERSION}`,
    };
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const { method, path, body, headers = {}, timeout, isFormData, idempotent } = options;
    const url = `${this.config.baseUrl}${path}`;

    const requestHeaders: Record<string, string> = {
      ...this.baseHeaders(),
      ...this.config.headers,
      ...headers
    };

    if (!isFormData) {
      requestHeaders['Content-Type'] = 'application/json';
    }

    return this.executeWithRetry<T>(
      () => ({
        url,
        path,
        method,
        init: {
          method,
          headers: requestHeaders,
          body: body ? (isFormData ? body as BodyInit : JSON.stringify(body)) : undefined,
        },
      }),
      timeout || this.config.timeout,
      mayRetry(method, idempotent, requestHeaders),
      hasIdempotencyKey(requestHeaders)
    );
  }

  /**
   * Upload a file with multipart form data. An upload is a write with no
   * Idempotency-Key, so it is sent once; a timeout surfaces as
   * OutcomeUnknownError.
   */
  async uploadFile<T>(
    path: string,
    file: Buffer | Blob,
    fileName: string,
    additionalFields: Record<string, string> = {}
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;

    // Create FormData
    const formData = new FormData();

    if (Buffer.isBuffer(file)) {
      const arrayBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
      formData.append('file', new Blob([arrayBuffer]), fileName);
    } else {
      formData.append('file', file, fileName);
    }

    formData.append('fileName', fileName);

    for (const [key, value] of Object.entries(additionalFields)) {
      formData.append(key, value);
    }

    const uploadHeaders: Record<string, string> = {
      ...this.baseHeaders(),
      'Authorization': `Bearer ${this.config.apiKey}`,
      ...this.config.headers
      // Don't set Content-Type for FormData — browser sets it with boundary
    };

    return this.executeWithRetry<T>(
      () => ({
        url,
        path,
        method: 'POST' as const,
        init: {
          method: 'POST' as const,
          headers: uploadHeaders,
          body: formData,
        },
      }),
      this.config.timeout * 2, // Double timeout for uploads
      false,
      false
    );
  }

  /**
   * Shared send-and-retry logic for request() and uploadFile().
   *
   * `retryable` is false for a write that is not marked idempotent: it goes
   * out once, and a timeout or network failure becomes OutcomeUnknownError.
   * A retryable request is resent on a network failure, its own timeout, a
   * 429, or a 5xx other than 501 and `not_available`. The wait honours
   * Retry-After when the server sends one, adds jitter, and stops once the
   * next wait would pass `retryDeadlineMs`.
   *
   * `keyed` (the request carries an Idempotency-Key) adds one more case, for
   * every method: a 409 `idempotency_in_progress` waits out the server's
   * Retry-After and sends the same request once more. It never repeats.
   */
  private async executeWithRetry<T>(
    buildRequest: () => Attempt,
    timeoutMs: number,
    retryable: boolean,
    keyed: boolean
  ): Promise<T> {
    let lastError: Error | null = null;
    // A later attempt can come back with no body (a proxy error page); the
    // user should still see the last real message the server sent.
    let lastInformative: DeleganceError | null = null;
    let attempts = 0;
    let inProgressWaited = false;
    const deadline = Date.now() + this.config.retryDeadlineMs;

    while (attempts <= this.config.retries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const attempt = buildRequest();
      let retryAfterMs: number | undefined;

      try {
        const response = await fetch(attempt.url, { ...attempt.init, signal: controller.signal });

        const data = await response.json().catch(() => ({}));
        const {traceId} = data;

        if (!response.ok) {
          const err = this.handleErrorResponse(response.status, data, traceId);
          if (typeof data.reason === 'string') err.reason = data.reason;
          if (typeof data.code === 'string') err.code = data.code;
          if (typeof data.retryable === 'boolean') err.retryable = data.retryable;
          if (data && typeof data === 'object') err.body = data as Record<string, unknown>;
          retryAfterMs = parseRetryAfterMs(response.headers?.get?.('Retry-After'));
          if (retryAfterMs === undefined && typeof data.retryAfter === 'number' && data.retryAfter > 0) {
            retryAfterMs = data.retryAfter * 1000;
          }
          if (err instanceof RateLimitError && err.retryAfter === undefined && retryAfterMs !== undefined && retryAfterMs > 0) {
            err.retryAfter = Math.ceil(retryAfterMs / 1000);
          }
          throw err;
        }

        return data as T;
      } catch (error) {
        const isHttpError = error instanceof DeleganceError;
        lastError = isHttpError
          ? error as Error
          : this.noResponseError(attempt, error, controller.signal.aborted, timeoutMs, retryable);
        if (isHttpError && error.message && error.message !== 'Unknown error') {
          lastInformative = error;
        }

        // The same key is still running on the server: wait it out once.
        // Retry-After is required; without it the caller decides.
        if (
          keyed &&
          !inProgressWaited &&
          isHttpError &&
          isIdempotencyInProgress(error) &&
          retryAfterMs !== undefined
        ) {
          const waitMs = this.jitter(retryAfterMs, true);
          if (Date.now() + waitMs <= deadline) {
            inProgressWaited = true;
            await this.delay(waitMs);
            continue;
          }
        }

        if (!retryable) {
          throw lastError;
        }

        // Every 4xx except 429 is a permanent answer, 501 means the
        // capability is not live, and a 503 with reason not_available is a
        // switched-off feature, not an outage.
        if (isHttpError) {
          const status = error.statusCode;
          const transient = status === 429 || isRetryableStatus(status);
          if (!transient || error.reason === 'not_available') {
            throw error;
          }
        }

        const waitMs = this.jitter(retryAfterMs ?? 2 ** (attempts + 1) * 1000, retryAfterMs !== undefined);
        const outOfTime = Date.now() + waitMs > deadline;

        if (attempts < this.config.retries && !outOfTime) {
          attempts++;
          await this.delay(waitMs);
          continue;
        }

        if (isHttpError && error.message === 'Unknown error' && lastInformative) {
          throw lastInformative;
        }
        throw lastError;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new DeleganceError('Request failed after retries', 500);
  }

  /**
   * The error for a request that got no HTTP response. A write surfaces as
   * OutcomeUnknownError, because it may have reached the server. A read keeps
   * the original error.
   */
  private noResponseError(
    attempt: Attempt,
    cause: unknown,
    timedOut: boolean,
    timeoutMs: number,
    retryable: boolean
  ): Error {
    if (attempt.method === 'GET') {
      return cause instanceof Error ? cause : new Error(String(cause));
    }
    const what = timedOut
      ? `no response within ${timeoutMs} ms`
      : `the connection failed (${cause instanceof Error ? cause.message : String(cause)})`;
    const advice = retryable
      ? 'It is safe to resend with the same Idempotency-Key.'
      : 'Check whether it went through before you send it again.';
    return new OutcomeUnknownError(
      `${attempt.method} ${attempt.path}: ${what}. The server may or may not have acted on it. ${advice}`,
      attempt.method,
      attempt.path,
      timedOut,
      cause
    );
  }

  /**
   * Spread retries so many clients do not return in lockstep. A server's
   * Retry-After is a floor, so jitter is added on top of it; an exponential
   * backoff keeps between half and all of its base.
   */
  private jitter(baseMs: number, isServerFloor: boolean): number {
    if (isServerFloor) {
      return baseMs + Math.floor(Math.random() * Math.min(1000, Math.max(100, baseMs * 0.2)));
    }
    return Math.floor(baseMs / 2 + Math.random() * (baseMs / 2));
  }

  private handleErrorResponse(status: number, data: Record<string, unknown>, traceId?: string): DeleganceError {
    const message = (data.message as string) || (data.error as string) || 'Unknown error';
    const {details} = data;

    switch (status) {
      case 401:
        return new AuthenticationError(message, traceId);
      case 400:
        return new ValidationError(message, details, traceId);
      case 403:
        return new ForbiddenError(message, traceId);
      case 404:
        return new NotFoundError(message, traceId);
      case 429:
        return new RateLimitError(
          message,
          data.retryAfter as number | undefined,
          traceId
        );
      case 501:
        return new NotImplementedError(message, traceId);
      default:
        return new DeleganceError(message, status, traceId, details);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
