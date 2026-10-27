/**
 * Remembers the last command's metadata so `delegance feedback --include-last`
 * can attach it. Stored in ~/.delegance/last-command.json (0600).
 *
 * What is kept: the command path from the command tree ("quote submit"), the
 * exit code, the trace id from an API error body, and the time. Never argv
 * values, answers files, keys, or tokens. Every field is checked against a
 * shape on the way in AND on the way out, so a value that does not fit is
 * dropped rather than cleaned.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Command } from 'commander';

export interface LastCommand {
  command: string;
  exitCode: number;
  traceId?: string;
  at: string;
}

const COMMAND_RE = /^[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*){0,3}$/;
const TRACE_RE = /^[0-9a-fA-F-]{8,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Commands that are never recorded, so --include-last points at the command before. */
const NOT_RECORDED = new Set(['feedback']);

export function lastCommandPath(): string {
  return path.join(os.homedir(), '.delegance', 'last-command.json');
}

/** The command's path in the tree, root excluded: "claim file". Arguments never appear here. */
export function commandPathOf(cmd: Command): string {
  const names: string[] = [];
  let c: Command | null = cmd;
  while (c && c.parent) {
    names.unshift(c.name());
    c = c.parent;
  }
  return names.join(' ');
}

/** Shape-check a record. Returns null when the required fields do not fit. */
export function sanitizeLastCommand(raw: unknown): LastCommand | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.command !== 'string' || r.command.length > 60 || !COMMAND_RE.test(r.command)) return null;
  if (typeof r.exitCode !== 'number' || !Number.isInteger(r.exitCode) || r.exitCode < -1 || r.exitCode > 255) return null;
  if (typeof r.at !== 'string' || !ISO_RE.test(r.at)) return null;
  const out: LastCommand = { command: r.command, exitCode: r.exitCode, at: r.at };
  if (typeof r.traceId === 'string' && TRACE_RE.test(r.traceId)) out.traceId = r.traceId;
  return out;
}

export function recordLastCommand(meta: LastCommand): void {
  const clean = sanitizeLastCommand(meta);
  const file = lastCommandPath();
  try {
    if (!clean) {
      // A record we cannot trust must not leave the previous one standing as "last".
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(clean), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort: a read-only home must never fail the command that just ran.
  }
}

export function readLastCommand(): LastCommand | null {
  try {
    return sanitizeLastCommand(JSON.parse(fs.readFileSync(lastCommandPath(), 'utf8')));
  } catch {
    return null;
  }
}

let current: { command: string; traceId?: string } | null = null;

export function beginCommand(command: string): void {
  current = { command };
}

/** Called by the shared error path with the API's trace id, if the error had one. */
export function noteTraceId(traceId: unknown): void {
  if (current && typeof traceId === 'string' && TRACE_RE.test(traceId)) current.traceId = traceId;
}

export function finishCommand(exitCode: number, now: Date = new Date()): void {
  if (!current || NOT_RECORDED.has(current.command)) return;
  recordLastCommand({ command: current.command, exitCode, traceId: current.traceId, at: now.toISOString() });
  current = null;
}

/** Wire the recorder into the real binary. Tests build the program without it. */
export function installLastCommandRecorder(program: Command): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    beginCommand(commandPathOf(actionCommand));
  });
  process.on('exit', (code) => {
    finishCommand(typeof code === 'number' ? code : Number(process.exitCode ?? 0));
  });
}
