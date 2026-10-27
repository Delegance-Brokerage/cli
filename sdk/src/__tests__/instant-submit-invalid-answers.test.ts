import { describe, it, expect, vi, afterEach } from 'vitest';
import { InstantQuotesModule, invalidAnswersDetails } from '../modules/instant-quotes';
import { HttpClient } from '../utils/http';
import { DeleganceError } from '../types';

function respond(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status < 400,
    status,
    json: async () => body,
    headers: { get: () => null },
  })));
}

const submitInput = { submissionId: 's1', sessionVersion: 'v1', answers: { q1: '2019' } };
const module = () => new InstantQuotesModule(new HttpClient({ apiKey: 'dlg_k', baseUrl: 'http://api.test', retries: 0 }));

async function caught(p: Promise<unknown>): Promise<DeleganceError> {
  try {
    await p;
  } catch (e) {
    return e as DeleganceError;
  }
  throw new Error('expected a rejection');
}

afterEach(() => vi.unstubAllGlobals());

describe('instantQuotes.submit on refused answers', () => {
  it('puts the questions, reasons and hint on details', async () => {
    const questions = [
      { id: 'q1', label: 'Business start date', reason: 'bad_date' },
      { id: 'q2', label: 'Entity type', reason: 'option_not_offered', allowed: ['LLC', 'Corporation'] },
    ];
    respond(422, {
      error: 'Unprocessable Entity',
      reason: 'uw_answers_invalid',
      message: '2 required answers are not in a form the carrier accepts.',
      questionIds: ['q1', 'q2'],
      questions,
      hint: 'Dates use YYYY-MM-DD.',
      traceId: 't1',
    });
    const err = await caught(module().submit(submitInput));
    expect(err).toBeInstanceOf(DeleganceError);
    expect(err.statusCode).toBe(422);
    expect(err.reason).toBe('uw_answers_invalid');
    expect(err.message).toBe('2 required answers are not in a form the carrier accepts.');
    expect(err.details).toEqual({ questionIds: ['q1', 'q2'], questions, hint: 'Dates use YYYY-MM-DD.' });
  });

  it('reads an older server that sent only the code and ids', async () => {
    respond(400, { error: 'Bad Request', message: 'uw_answers_invalid', traceId: 't1' });
    const err = await caught(module().submit(submitInput));
    expect(err.reason).toBe('uw_answers_invalid');
    expect(err.details).toEqual({ questionIds: [], questions: [] });
  });

  it('leaves other errors alone', async () => {
    respond(409, { error: 'Conflict', message: 'active_request_exists', traceId: 't1' });
    const err = await caught(module().submit(submitInput));
    expect(invalidAnswersDetails(err)).toBeNull();
    expect(err.details).toBeUndefined();
  });
});
