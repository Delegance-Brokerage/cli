/**
 * Feedback Module: report a bug, an idea, or a question to Delegance.
 *
 * Any API key may report. The server scrubs credentials from the message and
 * keeps only known context fields, but send no secrets: the context is for
 * the command name, exit code, trace id, and versions.
 */

import { randomUUID } from 'crypto';
import { HttpClient } from '../utils/http';

export type FeedbackType = 'bug' | 'idea' | 'question';

/** Matches the server cap; longer messages are refused, not cut. */
export const FEEDBACK_MESSAGE_MAX = 500;

export interface FeedbackContext {
  /** Command path only, e.g. "quote submit". Never arguments. */
  command?: string;
  exitCode?: number;
  /** The traceId from an error response, if the failure returned one. */
  traceId?: string;
  /** ISO timestamp of the failed command. */
  at?: string;
  cliVersion?: string;
  sdkVersion?: string;
}

export interface SubmitFeedbackInput {
  /** Defaults to 'bug'. */
  type?: FeedbackType;
  message: string;
  context?: FeedbackContext;
}

export class FeedbackModule {
  constructor(private http: HttpClient) {}

  /**
   * File a report. Returns the reference id Delegance uses to find it.
   *
   * Each call sends one Idempotency-Key, and the client's automatic retries of
   * that call reuse it. The route dedupes on the key, so a lost response never
   * files the report twice. Pass your own key to make a retry of your own (a
   * second call) safe as well.
   */
  async submit(input: SubmitFeedbackInput, opts: { idempotencyKey?: string } = {}): Promise<{ id: string }> {
    const message = (input.message ?? '').trim();
    if (!message) throw new Error('Feedback needs a message.');
    if (message.length > FEEDBACK_MESSAGE_MAX) {
      throw new Error(`Keep the message to ${FEEDBACK_MESSAGE_MAX} characters or fewer.`);
    }
    const body: Record<string, unknown> = { type: input.type ?? 'bug', message };
    if (input.context && Object.keys(input.context).length > 0) body.context = input.context;
    const res = await this.http.request<{ data: { id: string } }>({
      method: 'POST',
      path: '/api/v1/feedback',
      body,
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
      // The route looks up a report already filed under this key and returns
      // its id (app/api/v1/feedback/route.ts), so a resend cannot file twice.
      idempotent: true,
    });
    return { id: res.data.id };
  }
}
