import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

const brokerHandoffQuestions = vi.fn();
const brokerHandoff = vi.fn();
vi.mock('../utils/client', () => ({
  getClient: () => ({ instantQuotes: { brokerHandoffQuestions, brokerHandoff } }),
  failWith: (label: string, err: unknown) => { throw new Error(`${label}: ${String(err)}`); },
}));

// eslint-disable-next-line import-x/first -- after vi.mock
import { handoffLines, runBrokerHandoff } from '../commands/instant-quote';

describe('handoffLines', () => {
  it('says a broker has it and ends with the status command', () => {
    expect(handoffLines({ submissionId: 's1', unansweredRequired: 0, alreadyHandedOff: false })).toEqual([
      'A Delegance broker has this request and will place it with a market that quotes by hand.',
      'Check it: delegance quote status s1',
    ]);
  });

  it('names how many answers the broker still needs', () => {
    expect(handoffLines({ submissionId: 's1', unansweredRequired: 4, alreadyHandedOff: false })[1]).toBe(
      'The broker will email you for the 4 answer(s) still missing.',
    );
  });

  it('does not re-announce a request already with a broker', () => {
    expect(handoffLines({ submissionId: 's1', unansweredRequired: 2, alreadyHandedOff: true })).toEqual([
      'A Delegance broker already has this request.',
      'Check it: delegance quote status s1',
    ]);
  });
});

describe('runBrokerHandoff without a terminal', () => {
  beforeEach(() => {
    brokerHandoffQuestions.mockReset();
    brokerHandoff.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sends the request to the broker as is, marked incomplete, with the instant answers', async () => {
    brokerHandoffQuestions.mockResolvedValue({ submissionId: 's1', coverages: ['general_liability'], questions: [{ id: 'fein', label: 'FEIN', type: 'text', required: true }], alreadyHandedOff: false });
    brokerHandoff.mockResolvedValue({ status: 'broker_review', submissionId: 's1', brokerTaskId: 't1', coverages: [], unansweredRequired: 1, alreadyHandedOff: false });
    await runBrokerHandoff('s1', { cf_fein: '12-3456789' }, { json: true });
    expect(brokerHandoffQuestions).toHaveBeenCalledWith('s1', { cf_fein: '12-3456789' });
    expect(brokerHandoff).toHaveBeenCalledTimes(1);
    expect(brokerHandoff).toHaveBeenCalledWith(
      's1',
      { answers: {}, instantAnswers: { cf_fein: '12-3456789' }, complete: false },
      { idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    );
  });

  it('files nothing twice when the request is already with a broker', async () => {
    brokerHandoffQuestions.mockResolvedValue({ submissionId: 's1', coverages: [], questions: [], alreadyHandedOff: true, brokerTaskId: 't1' });
    await runBrokerHandoff('s1', {}, { json: true });
    expect(brokerHandoff).not.toHaveBeenCalled();
  });
});
