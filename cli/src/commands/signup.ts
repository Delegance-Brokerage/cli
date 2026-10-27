/**
 * `delegance signup` and `delegance verify`: get an API key from the terminal.
 *
 *   signup   creates the account, registers this terminal, emails a confirm
 *            link, then waits for the click and stores a user-bound key
 *   verify   resumes a signup (after Ctrl-C or on another day), and can re-send
 *            the email with --resend
 *
 * The key is collected with a device secret that never leaves this machine,
 * so a leaked signup link or bootstrap key cannot mint a key.
 *
 * Before the account exists the user accepts the Terms of Service (links plus
 * the self-directed placement summary, then a yes or --accept-terms). The
 * server refuses the enrollment without it and records the same version and
 * time fields web signup records.
 */

import { createHash } from 'crypto';
import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { createSignup, newDeviceSecret, DeleganceError, type TermsInfo } from '@delegance/sdk';
import { getBaseUrl, storeApiKey, setConfig, maskApiKey } from '../utils/config';
import { CLI_CLIENT_HEADERS } from '../version';
import { PORTAL_URL, failWith } from '../utils/client';
import { error, info, success, warn } from '../utils/output';
import { clearPendingSignup, loadPendingSignup, savePendingSignup, type PendingSignup } from '../utils/pending-signup';
import { confirmTerms } from './terms';
import { cliInvocation } from '../utils/invocation';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Must match CompanySizeSchema in lib/supabase/schema-guards.ts (0 = owner-only). */
export const COMPANY_SIZES = ['0', '1', '2-10', '11-25', '26-50', '51-100', '100-499', '500+'];

const REQUIRED_FLAGS: [string, string][] = [
  ['email', '--email'],
  ['business', '--business'],
  ['first', '--first'],
  ['last', '--last'],
  ['industry', '--industry'],
  ['size', '--size'],
  ['street', '--street'],
  ['city', '--city'],
  ['state', '--state'],
  ['zip', '--zip'],
];

/**
 * The flags a signup still needs. Without a terminal there is no one to prompt,
 * and an unanswered inquirer prompt exits 0 with no output. Exported for tests.
 */
export function missingSignupFields(options: Record<string, unknown>): string[] {
  return REQUIRED_FLAGS.filter(([k]) => !String(options[k] ?? '').trim()).map(([, flag]) => flag);
}

/** Mirror the API's address rules so a typo fails before the account exists. Exported for tests. */
export function addressProblem(a: { street: string; city: string; state: string; zip: string }): string | null {
  if (!a.street.trim() || !a.city.trim()) return 'Street and city are required.';
  if (!/^[A-Za-z]{2}$/.test(a.state.trim())) return 'State must be the 2-letter code, e.g. TX.';
  if (!/^\d{5}(-\d{4})?$/.test(a.zip.trim())) return 'ZIP must be 5 digits (or ZIP+4).';
  return null;
}

const TERMS_REASONS = new Set(['terms_not_accepted', 'terms_version_outdated']);

/** Did the server refuse the enrollment over the Terms? Exported for tests. */
export function isTermsRefusal(err: unknown): boolean {
  return err instanceof DeleganceError && TERMS_REASONS.has(String(err.reason ?? ''));
}

/**
 * Read the Terms the server wants accepted. A 404 means a server that predates
 * the Terms step (this CLI can ship to npm before that server deploys), and
 * such a server does not ask for acceptance, so the answer is null. Any other
 * failure is unknown and rethrows. Exported for tests.
 */
export async function loadSignupTerms(get: () => Promise<TermsInfo>): Promise<TermsInfo | null> {
  try {
    return await get();
  } catch (err) {
    if (err instanceof DeleganceError && err.statusCode === 404) return null;
    throw err;
  }
}

/**
 * Show the current Terms and ask. Returns the accepted version, or exits:
 * nothing is created for a user who does not accept. Returns '' when the
 * server has no Terms step; a later `delegance verify` asks again.
 */
async function loadSignupTermsOrExit(baseUrl: string): Promise<TermsInfo | null> {
  try {
    return await loadSignupTerms(() => createSignup({ baseUrl, headers: CLI_CLIENT_HEADERS }).getTerms());
  } catch (err) {
    failWith('Could not load the Terms of Service', err);
  }
}

/**
 * What a run with no terminal still lacks. `--accept-terms` is required only
 * when the server serves the Terms (`terms` non-null); against a server that
 * predates the Terms step (404, `terms` null) the legacy signup goes on
 * without it. Exported for tests.
 */
export function nonInteractiveMissing(options: Record<string, unknown>, terms: TermsInfo | null): string[] {
  const missing = missingSignupFields(options);
  if (terms && options.acceptTerms !== true) missing.push('--accept-terms');
  return missing;
}

/**
 * Where the Terms are asked. `signup` asks before the account exists;
 * `verify` asks after createAccount succeeded, so the account is already there.
 */
export type TermsStage = 'signup' | 'verify';

/** What to print when the Terms were not accepted. Exported for tests. */
export function termsNotAcceptedMessage(stage: TermsStage, interactive: boolean): string {
  if (stage === 'verify') {
    const verify = `${cliInvocation()} verify`;
    return interactive
      ? `Your account exists, but setup is not finished. Run "${verify}" again and accept the Terms and Privacy Policy to finish it.`
      : `No terminal to ask in. Your account exists, but setup is not finished. Read the Terms and Privacy Policy above, then run "${verify} --accept-terms".`;
  }
  return interactive
    ? 'Not signed up. Delegance needs your acceptance of the Terms and Privacy Policy to open an account.'
    : 'No terminal to ask in. Read the Terms and Privacy Policy above, then pass --accept-terms.';
}

/** `preloaded` skips the fetch when the caller already read the Terms. */
async function acceptTermsOrExit(
  stage: TermsStage,
  baseUrl: string,
  flag: boolean,
  preloaded?: TermsInfo | null,
): Promise<string> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const terms = preloaded === undefined ? await loadSignupTermsOrExit(baseUrl) : preloaded;
  if (!terms) return '';
  const ok = await confirmTerms(terms, { flag, interactive });
  if (!ok) {
    const message = termsNotAcceptedMessage(stage, interactive);
    if (interactive) warn(message);
    else error(message);
    process.exit(1);
  }
  return terms.version;
}

/** Explain an exchange refusal. Exported for tests. */
export function exchangeRefusal(err: unknown): string | null {
  if (!(err instanceof DeleganceError)) return null;
  switch (err.reason) {
    case 'account_exists':
      return `This email already has a Delegance account, so signup did not attach it to a new one. Sign in and create a key at ${PORTAL_URL}/portal/settings/api-keys`;
    case 'already_collected':
      return `The key for this signup was already collected. If you lost it, create a new key at ${PORTAL_URL}/portal/settings/api-keys`;
    case 'expired':
      return `This signup expired (24 hours). Run "${cliInvocation()} signup" again.`;
    default:
      return null;
  }
}

/**
 * Register this terminal against the account, if a signup stopped after the
 * account was created (network drop, Ctrl-C). The bootstrap key is shown only
 * once, which is why it is saved before this step runs.
 */
async function ensureEnrolled(pending: PendingSignup): Promise<PendingSignup> {
  if (pending.enrollmentId) return pending;
  const signup = createSignup({ baseUrl: pending.baseUrl, headers: CLI_CLIENT_HEADERS });
  const hash = createHash('sha256').update(pending.deviceSecret).digest('hex');
  const enrollment = await signup.enroll(pending.bootstrapKey, {
    deviceSecretHash: hash,
    firstName: pending.firstName ?? '',
    lastName: pending.lastName ?? '',
    termsAccepted: true,
    termsVersion: pending.termsVersion ?? '',
  });
  const next: PendingSignup = { ...pending, enrollmentId: enrollment.enrollmentId, verificationSent: false };
  savePendingSignup(next);
  return sendVerification(next);
}

/** Send (or re-send) the confirm email and record that it went out. */
async function sendVerification(pending: PendingSignup): Promise<PendingSignup> {
  await createSignup({ baseUrl: pending.baseUrl, headers: CLI_CLIENT_HEADERS }).requestVerification(pending.bootstrapKey);
  const next: PendingSignup = { ...pending, verificationSent: true };
  savePendingSignup(next);
  return next;
}

/** Store the key; if the disk write fails, print it once so it is not lost. */
export function storeOrPrintKey(apiKey: string, store: (k: string) => void = storeApiKey): boolean {
  try {
    store(apiKey);
    return true;
  } catch (err) {
    error(`Could not save the key to ~/.delegance/credentials: ${(err as Error).message}`);
    warn(`Your key is below. It is shown once. Save it now, then run "${cliInvocation()} auth login --key <key>".`);
    console.log(apiKey);
    return false;
  }
}

async function waitAndStore(pending: PendingSignup, timeoutMs: number): Promise<void> {
  const signup = createSignup({ baseUrl: pending.baseUrl, headers: CLI_CLIENT_HEADERS });
  const spinner = ora(`Waiting for you to click the link sent to ${pending.email} (Ctrl-C is safe: resume with "${cliInvocation()} verify")`).start();
  const started = Date.now();
  try {
    const result = await signup.waitForKey(pending.enrollmentId, pending.deviceSecret, {
      timeoutMs,
      intervalMs: 5000,
      onPoll: () => {
        spinner.text = `Waiting for the email confirmation (${Math.round((Date.now() - started) / 1000)}s). Check ${pending.email}.`;
      },
    });
    if (result.status !== 'ready') {
      spinner.warn('Still waiting on the email confirmation.');
      info(`Run "${cliInvocation()} verify" after you click the link.`);
      return;
    }
    spinner.stop();
    const stored = storeOrPrintKey(result.apiKey);
    setConfig('defaultCompanyId', result.companyId);
    // The key is either on disk or on screen; the secret has done its job.
    clearPendingSignup();
    if (stored) success(`Verified. API key ${maskApiKey(result.apiKey)} saved to ~/.delegance/credentials`);
    success(`You can quote now: ${cliInvocation()} quote start --coverage gl`);
  } catch (err) {
    spinner.stop();
    const why = exchangeRefusal(err);
    if (why) {
      if ((err as DeleganceError).reason !== 'already_collected') clearPendingSignup();
      error(why);
      process.exit(1);
    }
    failWith('Could not collect the key', err);
  }
}

/**
 * The prompts a signup still needs. Empty without a terminal: an unanswered
 * inquirer prompt exits 0 with no output, so a non-interactive run must never
 * reach one (even the optional description). Exported for tests.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- inquirer question objects
export function signupPrompts(options: Record<string, any>, interactive: boolean): Array<Record<string, any>> {
  if (!interactive) return [];
  const all: Array<Record<string, any>> = [
    { type: 'input', name: 'email', message: 'Work email:', when: !options.email, validate: (v: string) => EMAIL_RE.test(v) || 'Enter an email address' },
    { type: 'input', name: 'business', message: 'Business name:', when: !options.business, validate: (v: string) => !!v.trim() || 'Required' },
    { type: 'input', name: 'first', message: 'Your first name:', when: !options.first, validate: (v: string) => !!v.trim() || 'Required' },
    { type: 'input', name: 'last', message: 'Your last name:', when: !options.last, validate: (v: string) => !!v.trim() || 'Required' },
    { type: 'input', name: 'industry', message: 'What does the business do?', when: !options.industry, validate: (v: string) => !!v.trim() || 'Required' },
    { type: 'list', name: 'size', message: 'Employees:', choices: COMPANY_SIZES, when: !options.size },
    { type: 'input', name: 'street', message: 'Business street address:', when: !options.street, validate: (v: string) => !!v.trim() || 'Required' },
    { type: 'input', name: 'city', message: 'City:', when: !options.city, validate: (v: string) => !!v.trim() || 'Required' },
    { type: 'input', name: 'state', message: 'State (2 letters):', when: !options.state, validate: (v: string) => /^[A-Za-z]{2}$/.test(v.trim()) || 'Use the 2-letter code, e.g. TX' },
    { type: 'input', name: 'zip', message: 'ZIP:', when: !options.zip, validate: (v: string) => /^\d{5}(-\d{4})?$/.test(v.trim()) || '5 digits' },
    { type: 'input', name: 'description', message: 'In a sentence, what does the business do? (optional)', when: !options.description },
  ];
  return all.filter((q) => q.when !== false).map(({ when: _when, ...q }) => q);
}

export function createSignupCommand(): Command {
  return new Command('signup')
    .description('Create a Delegance account and get an API key, from the terminal')
    .option('-e, --email <email>', 'Your work email (the confirm link goes here)')
    .option('-b, --business <name>', 'Business name')
    .option('--first <name>', 'Your first name')
    .option('--last <name>', 'Your last name')
    .option('-i, --industry <industry>', 'What the business does, e.g. "commercial bakery"')
    .option('--size <size>', `Employees: ${COMPANY_SIZES.join(', ')}`)
    .option('-w, --website <url>', 'Website (full URL)')
    .option('--street <street>', 'Business street address')
    .option('--city <city>', 'City')
    .option('--state <state>', 'State, 2-letter code (carriers quote by state)')
    .option('--zip <zip>', 'ZIP code')
    .option('-d, --description <text>', 'A sentence on what the business does (helps carriers classify it)')
    .option('--accept-terms', 'Accept the Terms of Service and Privacy Policy (shown before the account is created)')
    .option('--timeout <minutes>', 'How long to wait for the email click', '15')
    .option('--no-wait', 'Send the email and exit; collect later with "delegance verify"')
    .action(async (options) => {
      const existing = loadPendingSignup();
      if (existing) {
        warn(`A signup for ${existing.email} is already waiting for its email confirmation.`);
        info(`Run "${cliInvocation()} verify" to finish it, or "${cliInvocation()} verify --cancel" to start over.`);
        process.exit(1);
      }

      const baseUrl = getBaseUrl();
      // Without a terminal, read the Terms before the missing-field check:
      // --accept-terms is required only when the server serves them.
      let preloadedTerms: TermsInfo | null | undefined;
      if (!(process.stdin.isTTY && process.stdout.isTTY)) {
        preloadedTerms = await loadSignupTermsOrExit(baseUrl);
        const missing = nonInteractiveMissing(options, preloadedTerms);
        if (missing.length) {
          error(`No terminal to ask in. Missing: ${missing.join(' ')}`);
          process.exit(1);
        }
      }
      const answers = await inquirer.prompt(signupPrompts(options, Boolean(process.stdin.isTTY && process.stdout.isTTY)) as any);
      const address = {
        street: String(options.street ?? answers.street).trim(),
        city: String(options.city ?? answers.city).trim(),
        state: String(options.state ?? answers.state).trim().toUpperCase(),
        zip: String(options.zip ?? answers.zip).trim(),
      };
      const badAddress = addressProblem(address);
      if (badAddress) {
        error(badAddress);
        process.exit(1);
      }
      const description = String(options.description ?? answers.description ?? '').trim();
      const email = String(options.email ?? answers.email).trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        error('Enter a valid email with --email');
        process.exit(1);
      }
      const size = String(options.size ?? answers.size);
      if (!COMPANY_SIZES.includes(size)) {
        error(`--size must be one of: ${COMPANY_SIZES.join(', ')}`);
        process.exit(1);
      }

      // Terms first: a user who declines leaves no account behind.
     const termsVersion = await acceptTermsOrExit('signup', baseUrl, options.acceptTerms === true, preloadedTerms);
      const signup = createSignup({ baseUrl, headers: CLI_CLIENT_HEADERS });
      const spinner = ora('Creating your account...').start();
      try {
        const account = await signup.createAccount({
          name: String(options.business ?? answers.business).trim(),
          contactEmail: email,
          industry: String(options.industry ?? answers.industry).trim(),
          companySize: size,
          address,
          ...(description ? { description } : {}),
          ...(options.website ? { website: options.website } : {}),
        });
        // Save BEFORE enrolling: the bootstrap key is shown once, so a failure
        // from here on must stay resumable with "delegance verify".
        const device = newDeviceSecret();
        let pending: PendingSignup = {
          enrollmentId: '',
          deviceSecret: device.secret,
          bootstrapKey: account.bootstrapKey,
          companyId: account.companyId,
          email,
          firstName: String(options.first ?? answers.first).trim(),
          lastName: String(options.last ?? answers.last).trim(),
          termsVersion,
          baseUrl,
          createdAt: new Date().toISOString(),
        };
        savePendingSignup(pending);
        pending = await ensureEnrolled(pending);
        spinner.succeed(`Account created. We emailed a confirm link to ${email}.`);
        if (account.warnings?.includes('address_not_saved')) {
          warn('We could not save your business address. Add it in the portal before quoting, or carriers cannot price you.');
        }
        if (options.wait === false) {
          info(`After you click it, run "${cliInvocation()} verify" to collect your API key.`);
          return;
        }
        await waitAndStore(pending, Number(options.timeout) * 60_000 || 15 * 60_000);
      } catch (err) {
        spinner.stop();
        failWith('Signup failed', err);
      }
    });
}

/**
 * Why a --resend failure never stops `verify`. Clicking the link revokes the
 * signup key, so a resend after the click fails with 401 even though the key
 * is ready to collect. Exported for tests.
 */
export function resendFailureMessage(err: unknown): string {
  if (err instanceof DeleganceError && (err.statusCode === 401 || err.statusCode === 403)) {
    return 'Your email is already confirmed, so there is nothing to re-send. Collecting your key now.';
  }
  const why = err instanceof Error ? err.message : String(err);
  return `Could not re-send the email (${why}). Still waiting for the link you already have.`;
}

export function createVerifyCommand(): Command {
  return new Command('verify')
    .description('Finish a signup: wait for the email click and store your API key')
    .option('--resend', 'Send the confirm email again')
    .option('--cancel', 'Forget the in-progress signup on this machine')
    .option('--accept-terms', 'Accept the Terms of Service, if this signup has not recorded an acceptance yet')
    .option('--timeout <minutes>', 'How long to wait', '15')
    .action(async (options) => {
      const pending = loadPendingSignup();
      if (!pending) {
        info(`No signup is waiting on this machine. Start one with "${cliInvocation()} signup".`);
        return;
      }
      if (options.cancel) {
        clearPendingSignup();
        success(`Forgot the signup for ${pending.email}.`);
        return;
      }
      let resumed = pending;
      if (pending.enrollmentId && pending.verificationSent === false) {
        // The confirm email request failed earlier: send it now.
        try {
          resumed = await sendVerification(pending);
          success(`Sent the confirm link to ${pending.email}.`);
        } catch (err) {
          failWith('Could not send the confirm email', err);
        }
      } else if (!pending.enrollmentId) {
        // A signup started by an older CLI, or one whose Terms changed while
        // it waited, must accept the current Terms before it can enroll.
        let toEnroll = pending;
        if (!pending.termsVersion) {
          toEnroll = { ...pending, termsVersion: await acceptTermsOrExit('verify', pending.baseUrl, options.acceptTerms === true) };
          savePendingSignup(toEnroll);
        }
        try {
          try {
            resumed = await ensureEnrolled(toEnroll);
          } catch (err) {
            if (!isTermsRefusal(err)) throw err;
            warn('The Terms of Service changed since this signup started. Review them again.');
            toEnroll = { ...toEnroll, termsVersion: await acceptTermsOrExit('verify', pending.baseUrl, options.acceptTerms === true) };
            savePendingSignup(toEnroll);
            resumed = await ensureEnrolled(toEnroll);
          }
          success(`Finished setting up the signup. We emailed a confirm link to ${pending.email}.`);
        } catch (err) {
          failWith('Could not finish the signup', err);
        }
      }
      if (options.resend && resumed === pending) {
        try {
          await createSignup({ baseUrl: pending.baseUrl, headers: CLI_CLIENT_HEADERS }).requestVerification(pending.bootstrapKey);
          success(`Sent the confirm link to ${pending.email} again.`);
        } catch (err) {
          info(resendFailureMessage(err));
        }
      }
      await waitAndStore(resumed, Number(options.timeout) * 60_000 || 15 * 60_000);
    });
}
