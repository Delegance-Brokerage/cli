/**
 * How the person launched the CLI, so every "run this next" hint repeats the
 * form that works in their shell. Someone who ran `npx -y @delegance/cli`
 * has no `delegance` on their PATH, so telling them "run delegance signup"
 * fails.
 */

export const NPX_INVOCATION = 'npx -y @delegance/cli';

/**
 * `npx -y @delegance/cli` when launched through npx, else `delegance`.
 * npx runs the bin out of its cache (`.../_npx/<hash>/...`). `npx delegance`
 * against a local install sets `npm_command=exec` and runs the delegance bin
 * directly; the bin check keeps other npx-run tools (a test runner) out.
 */
export function cliInvocation(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): string {
  const entry = (argv[1] ?? '').replace(/\\/g, '/');
  if (entry.includes('/_npx/')) return NPX_INVOCATION;
  if (env.npm_command === 'exec' && /(^|\/)delegance(\.[cm]?js)?$/.test(entry)) return NPX_INVOCATION;
  return 'delegance';
}

/** A full command to print in a hint: `cliCommand('quote status s1')` -> `delegance quote status s1`. */
export function cliCommand(rest: string): string {
  return `${cliInvocation()} ${rest}`;
}
