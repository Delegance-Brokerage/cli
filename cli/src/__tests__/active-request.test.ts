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
import { activeRequestLines } from '../commands/instant-quote';

function conflict(body: Record<string, unknown>): DeleganceError {
  const err = new DeleganceError(String(body.message), 409, 't1');
  err.body = body;
  return err;
}

describe('activeRequestLines', () => {
  it('names the request in market and prints both commands', () => {
    const lines = activeRequestLines(conflict({
      error: 'Conflict',
      message: 'active_request_exists',
      active: [{ submissionId: 'sub-old', carriers: [{ carrierId: 'next', state: 'QUOTED' }, { carrierId: 'coterie', state: 'QUOTING' }] }],
    }), 'gl');
    expect(lines).toEqual([
      'Already with carriers: sub-old, next (quoted), coterie (quoting).',
      'Check it: delegance quote status sub-old   Replace it: delegance quote start --coverage gl --replace',
    ]);
  });

  it('from quote submit, names the submit command with replace, not a bare start', () => {
    const lines = activeRequestLines(conflict({
      message: 'active_request_exists',
      active: [{ submissionId: 'sub-old', carriers: [] }],
    }), '<list>', { answersFile: 'answers.json', submit: { submissionId: 'sub-new', sessionVersion: '3' } });
    expect(lines?.[1]).toBe(
      'Check it: delegance quote status sub-old   '
      + 'Replace it: delegance quote submit sub-new --session-version 3 --answers answers.json --replace',
    );
    expect(lines?.[1]).not.toContain('quote start');
  });

  it('quotes an answers path that needs it and keeps a placeholder when none is known', () => {
    const quoted = activeRequestLines(conflict({ message: 'active_request_exists', active: [] }), '<list>', {
      answersFile: "my answers's.json",
      submit: { submissionId: 'sub-new', sessionVersion: '3' },
    });
    expect(quoted?.[1]).toContain(`--answers 'my answers'\\''s.json' --replace`);
    const bare = activeRequestLines(conflict({ message: 'active_request_exists', active: [] }), '<list>', {
      submit: { submissionId: 'sub-new', sessionVersion: '3' },
    });
    expect(bare?.[1]).toContain('--answers <file> --replace');
  });

  it('from quote start --answers, keeps the start form and carries the file', () => {
    const lines = activeRequestLines(conflict({
      message: 'active_request_exists',
      active: [{ submissionId: 'sub-old' }],
    }), 'gl,wc', { answersFile: 'a.json' });
    expect(lines?.[1]).toBe(
      'Check it: delegance quote status sub-old   Replace it: delegance quote start --coverage gl,wc --answers a.json --replace',
    );
  });

  it('from quote submit, an edited in-market submission still re-quotes through start', () => {
    const lines = activeRequestLines(conflict({ message: 'answers_changed_requote_required' }), '<list>', {
      answersFile: 'a.json',
      submit: { submissionId: 'sub-new', sessionVersion: '3' },
    });
    expect(lines?.[1]).toBe('Re-quote with the new answers: delegance quote start --coverage <list> --answers a.json --replace');
  });

  it('explains a replace conflict', () => {
    const lines = activeRequestLines(conflict({ message: 'replace_conflict', carrier: 'next' }), 'gl');
    expect(lines?.[0]).toBe('Cannot replace: next has a bind in progress or bound on the earlier request.');
  });

  it('points an edited submission at a re-quote', () => {
    const lines = activeRequestLines(conflict({ message: 'answers_changed_requote_required' }), 'gl,wc');
    expect(lines?.[1]).toBe('Re-quote with the new answers: delegance quote start --coverage gl,wc --replace');
  });

  it('leaves every other error to the generic handler', () => {
    expect(activeRequestLines(conflict({ message: 'session_version_mismatch' }), 'gl')).toBeNull();
    expect(activeRequestLines(new DeleganceError('x', 500), 'gl')).toBeNull();
    expect(activeRequestLines(new Error('x'), 'gl')).toBeNull();
  });
});
