import { describe, it, expect, vi } from 'vitest';
import { DeleganceError } from '@delegance/sdk';

vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

// eslint-disable-next-line import-x/first -- after vi.mock
import { invalidAnswerLines } from '../commands/instant-quote';

function refused(body: Record<string, unknown>, status = 422): DeleganceError {
  const err = new DeleganceError(String(body.message), status, 't1');
  err.reason = typeof body.reason === 'string' ? body.reason : undefined;
  err.body = body;
  return err;
}

describe('invalidAnswerLines', () => {
  it('prints one line per question by label, with the reason, the options, and the hint', () => {
    const lines = invalidAnswerLines(refused({
      error: 'Unprocessable Entity',
      reason: 'uw_answers_invalid',
      message: '3 required answers are not in a form the carrier accepts.',
      questionIds: ['q1', 'q2', 'q3'],
      questions: [
        { id: 'q1', label: 'Business start date', reason: 'bad_date' },
        { id: 'q2', label: 'Entity type', reason: 'option_not_offered', allowed: ['LLC', 'Corporation'] },
        { id: 'q3', label: '', reason: 'bad_number' },
      ],
      hint: 'Fix the answers listed and submit again.',
    }));
    expect(lines).toEqual([
      'Some answers need fixing before the carriers can quote:',
      '  - Business start date: not a full date. Use YYYY-MM-DD, for example 2024-03-15',
      '  - Entity type: not one of the options. Use one of: "LLC" | "Corporation"',
      '  - q3: not a number. Use digits only, for example 250000',
      'Fix the answers listed and submit again.',
    ]);
  });

  it('still says what to check when an older server names no questions', () => {
    const lines = invalidAnswerLines(refused({ error: 'Bad Request', message: 'uw_answers_invalid' }, 400));
    expect(lines?.[0]).toBe('Some answers need fixing before the carriers can quote:');
    expect(lines?.[1]).toContain('YYYY-MM-DD');
  });

  it('is null for any other error', () => {
    expect(invalidAnswerLines(refused({ message: 'active_request_exists' }, 409))).toBeNull();
    expect(invalidAnswerLines(new Error('boom'))).toBeNull();
  });
});
