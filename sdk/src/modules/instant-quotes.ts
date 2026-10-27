/**
 * Instant Quotes Module: real carrier premiums over the API.
 *
 * Needs a key with a person behind it (from `delegance signup`, or created in
 * the portal while signed in). Flow: `start` returns the questions, `submit`
 * files the answers with the carriers, `status` / `waitForQuotes` return
 * premiums as carriers answer, `bind` requests a bind on one offer.
 *
 * `submit` and `bind` send an Idempotency-Key. Pass your own to make a retry
 * across process restarts land on the same request; otherwise one is made per
 * call. Each write goes out once: a timeout throws OutcomeUnknownError, and
 * the SDK does not resend it on its own.
 */

import { randomUUID } from 'crypto';
import { HttpClient } from '../utils/http';
import { DeleganceError } from '../types';

export interface InstantQuestionOption {
  value: string;
  label: string;
}

export interface InstantQuestion {
  id: string;
  label: string;
  type: string;
  options?: InstantQuestionOption[];
  required: boolean;
  group?: string;
  /** Answered from the insured's own account data. Shown and editable. */
  prefill?: unknown;
  /** Inferred by a source. Counts only after the insured confirms it. */
  suggested?: { value: unknown; route?: string; confidence?: string };
  /** Required only while visible. */
  requiredIfShown?: boolean;
  /** Shown only when the named question's answer is one of `equals`. */
  showIf?: { questionId: string; equals: string[] };
  [key: string]: unknown;
}

/** One insured state's workers' comp market. */
export interface WcMarketState {
  state: string;
  stateName: string;
  /** monopolistic_state_fund: only the state fund writes WC; no private WC quote there. */
  marketType: 'monopolistic_state_fund' | 'competitive_state_fund' | 'private' | string;
  privateWcAllowed: boolean;
  stopGapElNeeded: boolean;
  stateFund: { name: string; shortName: string; url: string } | null;
  summary: string;
}

/** Workers' comp market by state, on a session that requested WC. */
export interface WcMarket {
  states: WcMarketState[];
  /**
   * `skipped` when every state is monopolistic: no private WC price, a broker handles WC.
   * `broker` when some state is monopolistic (or the states could not be read): a broker
   * quotes private WC for the private states instead of an instant quote.
   */
  privateWcQuote: 'requested' | 'skipped' | 'broker' | string;
  reason: string | null;
  message: string | null;
  stopGapElStates: string[];
  unknownStates: string[];
}

export interface InstantSession {
  submissionId: string;
  sessionVersion: string;
  decision: string;
  eligibleCarriers: { carrierId: string; name: string }[];
  questions: InstantQuestion[];
  /** Present only when workers' comp was requested. Absent on older servers. */
  wcMarket?: WcMarket;
}

export interface InstantSubmitResult {
  quotes: { carrierId: string; carrierName: string; premium: number | null; status: string }[];
  /** `missing` names the value that would bring a carrier dropped by a data floor back. */
  partialFailures: { carrierId: string; reason: string; missing?: string }[];
  acordCoverages: string[];
  status: 'submitted' | 'acord_pending' | 'no_carriers';
  /** The broker task, when ACORD lines were queued (`acord_pending`). */
  brokerTaskId?: string;
  /** On a replace: the earlier requests closed on our side, per coverage. */
  superseded?: { policyType: string; submissionIds: string[]; carriers: string[] }[];
  /** On a replace: coverages whose earlier request stayed open (nothing new was filed for them). */
  restored?: string[];
  replaceNotice?: string;
}

/** Why a submitted answer could not go to the carriers. */
export type InvalidAnswerReason = 'option_not_offered' | 'bad_date' | 'bad_number' | 'unusable';

export interface InvalidAnswer {
  /** The question id from `start`. */
  id: string;
  label: string;
  reason: InvalidAnswerReason | string;
  /** On `option_not_offered`: the accepted option labels (at most 10). */
  allowed?: string[];
  /** A plain sentence when answers conflict (a roof year before the year built). Absent on older servers. */
  detail?: string;
}

/**
 * `details` on the error `submit` throws when required answers are in a form
 * no carrier accepts (`reason: 'uw_answers_invalid'`). Nothing was sent; fix
 * the listed answers and submit again.
 */
export interface InvalidAnswersDetails {
  questionIds: string[];
  questions: InvalidAnswer[];
  hint?: string;
}

/** The structured details when `err` is a `uw_answers_invalid` refusal, else null. */
export function invalidAnswersDetails(err: unknown): InvalidAnswersDetails | null {
  if (!(err instanceof DeleganceError)) return null;
  const body = err.body ?? {};
  // Older servers answered 400 with the code in `message` and no questions.
  const isCode = err.reason === 'uw_answers_invalid' || body.error === 'uw_answers_invalid' || body.message === 'uw_answers_invalid';
  if (!isCode) return null;
  const questionIds = Array.isArray(body.questionIds) ? body.questionIds.filter((x): x is string => typeof x === 'string') : [];
  const questions = Array.isArray(body.questions)
    ? (body.questions as unknown[])
      .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object' && typeof (q as { id?: unknown }).id === 'string')
      .map((q) => ({
        id: q.id as string,
        label: typeof q.label === 'string' && q.label ? q.label : (q.id as string),
        reason: typeof q.reason === 'string' ? q.reason : 'unusable',
        ...(Array.isArray(q.allowed) ? { allowed: q.allowed.filter((a): a is string => typeof a === 'string') } : {}),
        ...(typeof q.detail === 'string' && q.detail ? { detail: q.detail } : {}),
      }))
    : questionIds.map((id) => ({ id, label: id, reason: 'unusable' }));
  return {
    questionIds: questionIds.length > 0 ? questionIds : questions.map((q) => q.id),
    questions,
    ...(typeof body.hint === 'string' ? { hint: body.hint } : {}),
  };
}

export interface CarrierQuote {
  opportunityId: string;
  carrierId: string;
  carrierName: string;
  coverage: string | null;
  state: string;
  marketStatus: string;
  /**
   * What this carrier's instant leg ended in: pending, quoted, bound,
   * referred (sent to an underwriter), needs_info, declined, expired, failed.
   * A referral reads 'pending' in `marketStatus`. Absent on older servers.
   */
  outcome?: string;
  premium: number | null;
  quoteNumber: string | null;
  bindable: boolean | null;
  /**
   * Human-readable limits, e.g. "$1M per occurrence / $2M aggregate" or
   * "Statutory / $1M employers liability". Null when the carrier sent none.
   * Absent on older servers.
   */
  limits?: string | null;
  /**
   * Deductible in dollars; 0 means none. Today only cyber quotes carry one
   * (the retention); every other line returns null. Absent on older servers.
   */
  deductible?: number | null;
  /**
   * The carrier result status (`needs_info`, `declined`, `failed`, ...). A
   * REFERRED quote with `needs_info` is closed: the carrier needs answers.
   * Absent on older servers.
   */
  resultStatus?: string | null;
  /**
   * Why the carrier did not price, in the carrier's own words (a decline) or
   * a plain sentence (needs info, referral). Null otherwise. Absent on older
   * servers.
   */
  message?: string | null;
  /**
   * True on a row for a carrier the submit held back (it is also listed in
   * `withheldCarriers`). It has no offer: `opportunityId` is empty and it
   * cannot be bound. Absent on older servers and on every real offer.
   */
  withheld?: boolean;
}

/** A carrier the submit did not send to, and why. */
export interface WithheldCarrier {
  carrierId: string;
  carrierName: string;
  /** `needs_info`: answer the facts in `needs` and quote again. `withheld`: excluded for another reason. */
  status: 'needs_info' | 'withheld';
  /** Short phrases for the missing facts ("building area"). Empty on `withheld`. */
  needs: string[];
  /**
   * One sentence, e.g. "CNA needs more information before it can quote:
   * Square footage of your business premises; Number of stories in your
   * building." (older servers: "CNA: needs building area, construction type").
   */
  message: string;
  /** The coverage the submit judged it on. Absent on older servers. */
  coverage?: string | null;
}

export interface InstantQuoteStatus {
  submissionId: string;
  coverages: string[];
  expiresAt: string | null;
  submitted: boolean;
  submitStatus: 'not_submitted' | 'in_progress' | 'completed';
  carrierQuotes: CarrierQuote[];
  /**
   * Carriers the session listed that the submit held back, each with a plain
   * reason. They have no offer; newer servers also list each one in
   * `carrierQuotes` as a `withheld: true` row. Absent on older servers.
   */
  withheldCarriers?: WithheldCarrier[];
  allCarriersResolved: boolean;
  awaitingBrokerReviewCount: number;
  /** When coverage would start, as an ISO date (YYYY-MM-DD). Absent on older servers. */
  effectiveDate?: string | null;
  /** The newest broker task on this submission; null when none. Absent when the server could not read it. */
  brokerReview?: { taskId: string; status: string; createdAt: string } | null;
}

/** ACORD questions a broker needs after a `no_carriers` result. */
export interface BrokerHandoffQuestions {
  submissionId: string;
  coverages: string[];
  questions: InstantQuestion[];
  /** True when this submission is already with a broker; `questions` is empty. */
  alreadyHandedOff: boolean;
  brokerTaskId?: string | null;
}

export interface BrokerHandoffResult {
  status: 'broker_review';
  submissionId: string;
  brokerTaskId: string | null;
  coverages: string[];
  /** Required questions left blank. The broker asks them. */
  unansweredRequired: number;
  alreadyHandedOff: boolean;
}

/**
 * Premium financing at the point of sale. Present only when Delegance has the
 * lane switched on. Terms are the LENDER's, reported once the insured starts
 * financing; they are null before that.
 */
export interface FinancingOffer {
  available: boolean;
  availability: 'provider_confirmed' | 'precheck_passed' | 'unavailable';
  provider: string;
  lender: string;
  reason: string | null;
  /** The portal finance checkout (sign in to the portal to use it). */
  checkoutUrl: string | null;
  premiumFinal: boolean;
  terms: {
    aprBps: number | null;
    downPaymentCents: number | null;
    amountFinancedCents: number | null;
    financeChargeCents: number | null;
    installmentCents: number | null;
    numberOfInstallments: number | null;
    totalOfPaymentsCents: number | null;
    agreementUrl: string | null;
    providerQuoteRef: string | null;
    providerQuoteStatus: string | null;
  } | null;
  applicationStatus: string | null;
  disclosure: string;
}

export interface BindRequestResult {
  bindRequestId: string;
  status: string;
  carrierName: string;
  coverage: string;
  premium: number | null;
  existing: boolean;
  next: string;
  /** Fast bind only: 'A' opens the carrier's own checkout, 'C' goes to a broker. */
  tier?: 'A' | 'C';
  /** Tier C: why the offer could not use the carrier checkout. */
  reasons?: string[];
  /** Tier A: the carrier's checkout page. The policy is bound only when the carrier confirms. */
  checkoutUrl?: string;
  /** Point-of-sale premium financing, when offered. */
  financing?: FinancingOffer;
}

/** The first fast-bind call emails a code; send it back with `stepUpId`. */
export interface BindStepUpRequired {
  stepUpRequired: true;
  stepUpId: string;
  channel: 'email';
  sentTo: string;
  expiresAt: string | null;
}

export interface FastBindInput {
  /** You confirm the application answers are accurate. Required by fast bind. */
  attest?: boolean;
  stepUpId?: string;
  code?: string;
  idempotencyKey?: string;
}

export class InstantQuotesModule {
  constructor(private http: HttpClient) {}

  /**
   * `fresh: true` always mints a new submission instead of reusing a warm
   * session for the same coverages. Use it with `submit({ replace: true })`
   * to re-quote coverage that already has a request with carriers.
   */
  async start(coverages: string[], opts: { fresh?: boolean } = {}): Promise<InstantSession> {
    const res = await this.http.request<{ data: InstantSession }>({
      method: 'POST',
      path: '/api/v1/quotes/instant/session',
      body: opts.fresh ? { coverages, fresh: true } : { coverages },
    });
    return res.data;
  }

  async submit(
    input: {
      submissionId: string;
      sessionVersion: string;
      answers: Record<string, unknown>;
      /**
       * Close the earlier request for the same coverage and re-quote. Without
       * it, a submit while one is with carriers returns 409
       * `active_request_exists`. A carrier may still see the earlier
       * application: CoverForce has no withdraw call.
       */
      replace?: boolean;
    },
    opts: { idempotencyKey?: string } = {},
  ): Promise<InstantSubmitResult> {
    try {
      const res = await this.http.request<{ data: InstantSubmitResult }>({
        method: 'POST',
        path: '/api/v1/quotes/instant/submit',
        body: input,
        headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
      });
      return res.data;
    } catch (err) {
      // A refused answer set: put the questions on `details` (InvalidAnswersDetails).
      const details = invalidAnswersDetails(err);
      if (details && err instanceof DeleganceError) {
        err.details = details;
        err.reason = 'uw_answers_invalid';
      }
      throw err;
    }
  }

  async status(submissionId: string): Promise<InstantQuoteStatus> {
    const res = await this.http.request<{ data: InstantQuoteStatus }>({
      method: 'GET',
      path: `/api/v1/quotes/instant/${encodeURIComponent(submissionId)}`,
    });
    return res.data;
  }

  /** Polls `status` until every visible carrier resolved, or the timeout. */
  async waitForQuotes(
    submissionId: string,
    opts: { timeoutMs?: number; intervalMs?: number; onPoll?: (s: InstantQuoteStatus) => void } = {},
  ): Promise<InstantQuoteStatus> {
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const intervalMs = opts.intervalMs ?? 10_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- polling is sequential by design.
      const s = await this.status(submissionId);
      opts.onPoll?.(s);
      const remaining = deadline - Date.now();
      if (s.allCarriersResolved || remaining <= 0) return s;
      // eslint-disable-next-line no-await-in-loop -- polling is sequential by design.
      await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
  }

  /**
   * After a `no_carriers` submit: the ACORD questions a broker needs to place
   * the risk with a non-instant market. Pass the answers you submitted so
   * facts you already gave are not asked again.
   */
  async brokerHandoffQuestions(submissionId: string, instantAnswers: Record<string, unknown> = {}): Promise<BrokerHandoffQuestions> {
    const res = await this.http.request<{ data: BrokerHandoffQuestions }>({
      method: 'POST',
      path: `/api/v1/quotes/instant/${encodeURIComponent(submissionId)}/broker-handoff/questions`,
      body: { instantAnswers },
    });
    return res.data;
  }

  /**
   * Hands a `no_carriers` submission to a Delegance broker as a non-instant
   * request, with whatever ACORD answers you have. `complete: false` says you
   * stopped early; the broker asks the rest. A repeat call returns the same
   * broker task.
   */
  async brokerHandoff(
    submissionId: string,
    input: { answers: Record<string, unknown>; instantAnswers?: Record<string, unknown>; complete?: boolean },
    opts: { idempotencyKey?: string } = {},
  ): Promise<BrokerHandoffResult> {
    const res = await this.http.request<{ data: BrokerHandoffResult }>({
      method: 'POST',
      path: `/api/v1/quotes/instant/${encodeURIComponent(submissionId)}/broker-handoff`,
      body: input,
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
    return res.data;
  }

  /** Requests a bind on one offer. A licensed broker reviews it; nothing is charged. */
  async bind(submissionId: string, opportunityId: string, opts: { idempotencyKey?: string } = {}): Promise<BindRequestResult> {
    const res = await this.http.request<{ data: BindRequestResult }>({
      method: 'POST',
      path: `/api/v1/quotes/instant/${encodeURIComponent(submissionId)}/bind`,
      body: { opportunityId },
      headers: { 'Idempotency-Key': opts.idempotencyKey ?? randomUUID() },
    });
    return res.data;
  }

  /**
   * Bind through fast bind: an owner or admin attests the answers, gets a
   * 6-digit code by email (the first call returns `stepUpRequired`), then calls
   * again with `stepUpId` and `code`. A tier A offer returns `checkoutUrl`;
   * any other offer goes to a broker.
   */
  async bindWithStepUp(submissionId: string, opportunityId: string, input: FastBindInput = {}): Promise<BindRequestResult | BindStepUpRequired> {
    const { idempotencyKey, ...rest } = input;
    const res = await this.http.request<{ data?: BindRequestResult } & Partial<BindStepUpRequired>>({
      method: 'POST',
      path: `/api/v1/quotes/instant/${encodeURIComponent(submissionId)}/bind`,
      body: { opportunityId, ...rest },
      headers: { 'Idempotency-Key': idempotencyKey ?? randomUUID() },
    });
    if (res.stepUpRequired && res.stepUpId) {
      return { stepUpRequired: true, stepUpId: res.stepUpId, channel: 'email', sentTo: res.sentTo ?? '', expiresAt: res.expiresAt ?? null };
    }
    return res.data as BindRequestResult;
  }
}
