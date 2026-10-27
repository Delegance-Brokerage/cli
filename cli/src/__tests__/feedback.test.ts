import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// config.ts builds a Conf store at import time; keep it off the real disk.
vi.mock('conf', () => {
  class MockConf {
    get() { return undefined; }

    set() {}

    delete() {}

    get path() { return '/tmp/delegance-test-config.json'; }
  }
  return { default: MockConf };
});

const prompt = vi.fn();
vi.mock('inquirer', () => ({ default: { prompt: (...a: unknown[]) => prompt(...a) } }));

const submit = vi.fn();
vi.mock('../utils/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('../utils/client')>();
  return { ...real, getClient: () => ({ feedback: { submit } }) };
});

import { createProgram } from '../program';
import { CLI_VERSION } from '../version';
import {
  beginCommand,
  commandPathOf,
  finishCommand,
  lastCommandPath,
  noteTraceId,
  readLastCommand,
  recordLastCommand,
} from '../utils/last-command';
import { buildFeedbackContext, feedbackInputMode } from '../commands/feedback';

const API_KEY = 'dlg_abcd1234_sk_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
const TRACE = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

let home: string;
const savedHome = process.env.HOME;
const savedStdinTTY = process.stdin.isTTY;
const savedStdoutTTY = process.stdout.isTTY;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'dlg-feedback-'));
  process.env.HOME = home;
  prompt.mockReset();
  submit.mockReset();
  submit.mockResolvedValue({ id: 'fb-123' });
});

afterEach(() => {
  process.env.HOME = savedHome;
  Object.defineProperty(process.stdin, 'isTTY', { value: savedStdinTTY, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: savedStdoutTTY, configurable: true });
  fs.rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function setTTY(on: boolean) {
  Object.defineProperty(process.stdin, 'isTTY', { value: on, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: on, configurable: true });
}

/** Run argv against a fresh program; process.exit throws so the run stops there. */
async function run(argv: string[]): Promise<{ exitCode: number | null; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { out.push(a.join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { err.push(a.join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
  let exitCode: number | null = null;
  try {
    await createProgram().parseAsync(['node', 'delegance', ...argv]);
  } catch (e) {
    const m = /^exit:(\d+)$/.exec((e as Error).message);
    if (!m) throw e;
    exitCode = Number(m[1]);
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n') };
}

describe('command tree', () => {
  it('registers feedback with the bug alias and its options', () => {
    const cmd = createProgram().commands.find((c) => c.name() === 'feedback')!;
    expect(cmd.aliases()).toContain('bug');
    expect(cmd.options.map((o) => o.long)).toEqual(expect.arrayContaining(['--type', '--include-last', '--json']));
  });
});

describe('feedbackInputMode', () => {
  it('uses a given message, prompts on a TTY, and refuses otherwise', () => {
    expect(feedbackInputMode({ message: 'it broke', isTTY: false })).toBe('given');
    expect(feedbackInputMode({ message: '', isTTY: true })).toBe('prompt');
    expect(feedbackInputMode({ message: '  ', isTTY: false })).toBe('usage_error');
  });
});

describe('delegance feedback without a TTY', () => {
  it('exits 2 with a usage error and no prompt or request when no message is given', async () => {
    setTTY(false);
    const r = await run(['feedback']);
    expect(r.exitCode).toBe(2);
    expect(r.err).toMatch(/delegance feedback "/);
    expect(prompt).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('the bug alias behaves the same', async () => {
    setTTY(false);
    expect((await run(['bug'])).exitCode).toBe(2);
    expect(submit).not.toHaveBeenCalled();
  });

  it('exits 2 for an unknown --type or an over-long message, without a request', async () => {
    setTTY(false);
    expect((await run(['bug', 'x', '--type', 'rant'])).exitCode).toBe(2);
    expect((await run(['bug', 'x'.repeat(501)])).exitCode).toBe(2);
    expect(submit).not.toHaveBeenCalled();
  });

  it('sends a message given as words and prints the reference id', async () => {
    setTTY(false);
    const r = await run(['bug', 'quote', 'submit', 'hung']);
    expect(r.exitCode).toBeNull();
    expect(submit).toHaveBeenCalledWith({ type: 'bug', message: 'quote submit hung', context: undefined });
    expect(r.out).toContain('fb-123');
  });

  it('--json prints only the id', async () => {
    setTTY(false);
    const r = await run(['feedback', 'dark mode please', '--type', 'idea', '--json']);
    expect(JSON.parse(r.out)).toEqual({ id: 'fb-123' });
    expect(submit.mock.calls[0][0].type).toBe('idea');
  });
});

describe('delegance feedback on a TTY', () => {
  it('prompts for the message when none is given', async () => {
    setTTY(true);
    prompt.mockResolvedValue({ message: 'the table wraps badly' });
    await run(['feedback']);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].message).toBe('the table wraps badly');
  });
});

describe('last command metadata', () => {
  it('records name, exit code, trace id and time, owner-only, in ~/.delegance', () => {
    recordLastCommand({ command: 'quote submit', exitCode: 1, traceId: TRACE, at: '2026-09-24T15:00:00.000Z' });
    const file = lastCommandPath();
    expect(file).toBe(path.join(home, '.delegance', 'last-command.json'));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(readLastCommand()).toEqual({ command: 'quote submit', exitCode: 1, traceId: TRACE, at: '2026-09-24T15:00:00.000Z' });
  });

  it('never stores argv values: the command is the tree path only', () => {
    const program = createProgram();
    const file = program.commands.find((c) => c.name() === 'claim')!.commands.find((c) => c.name() === 'file')!;
    expect(commandPathOf(file)).toBe('claim file');
    // A value that is not a bare command path is refused outright.
    recordLastCommand({ command: `claim file --description ${API_KEY}`, exitCode: 1, at: '2026-09-24T15:00:00.000Z' });
    expect(readLastCommand()).toBeNull();
  });

  it('drops a trace id that is not trace-shaped (a key never lands in the file)', () => {
    beginCommand('auth status');
    noteTraceId(API_KEY);
    finishCommand(1, new Date('2026-09-24T15:00:00.000Z'));
    const raw = fs.readFileSync(lastCommandPath(), 'utf8');
    expect(raw).not.toContain('dlg_');
    expect(readLastCommand()).toEqual({ command: 'auth status', exitCode: 1, at: '2026-09-24T15:00:00.000Z' });
  });

  it('does not record the feedback command itself, so --include-last points at the one before', () => {
    recordLastCommand({ command: 'quote submit', exitCode: 1, at: '2026-09-24T15:00:00.000Z' });
    beginCommand('feedback');
    finishCommand(0);
    expect(readLastCommand()?.command).toBe('quote submit');
  });

  it('reads a missing or corrupt file as nothing', () => {
    expect(readLastCommand()).toBeNull();
    fs.mkdirSync(path.join(home, '.delegance'), { recursive: true });
    fs.writeFileSync(lastCommandPath(), '{not json');
    expect(readLastCommand()).toBeNull();
  });
});

describe('--include-last', () => {
  it('attaches only the name, exit code, trace id, time and versions, even from a tampered file', async () => {
    fs.mkdirSync(path.join(home, '.delegance'), { recursive: true });
    fs.writeFileSync(lastCommandPath(), JSON.stringify({
      command: 'quote submit',
      exitCode: 1,
      traceId: TRACE,
      at: '2026-09-24T15:00:00.000Z',
      argv: ['quote', 'submit', '--answers', 'answers.json'],
      answers: { revenue: 850000 },
      apiKey: API_KEY,
    }));
    setTTY(false);
    await run(['bug', 'it hung', '--include-last']);
    const sent = submit.mock.calls[0][0];
    expect(sent.context).toEqual({
      command: 'quote submit',
      exitCode: 1,
      traceId: TRACE,
      at: '2026-09-24T15:00:00.000Z',
      cliVersion: CLI_VERSION,
      sdkVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
    expect(JSON.stringify(sent)).not.toContain('dlg_');
    expect(JSON.stringify(sent)).not.toContain('answers');
  });

  it('sends versions only when there is no last command', () => {
    expect(buildFeedbackContext(null)).toEqual({ cliVersion: CLI_VERSION, sdkVersion: expect.any(String) });
  });
});
