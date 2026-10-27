/**
 * The in-flight signup, kept on disk between `delegance signup` and the moment
 * the key is collected: ~/.delegance/pending-signup.json, mode 0600.
 *
 * It holds the device secret and the bootstrap key. The device secret is the
 * only thing that can collect the API key, so the file never leaves this
 * machine and is deleted as soon as the key is stored. The bootstrap key is
 * revoked server-side when the email is confirmed.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PendingSignup {
  /** Empty until enrollment succeeds; a signup can resume from the account step. */
  enrollmentId: string;
  firstName?: string;
  lastName?: string;
  /**
   * The Terms of Service version the user accepted before the account was
   * created. Sent with the enrollment; absent on a signup started by an older
   * CLI, which asks again before it enrolls.
   */
  termsVersion?: string;
  /** False until the confirm email request succeeded; verify re-sends it. */
  verificationSent?: boolean;
  deviceSecret: string;
  bootstrapKey: string;
  companyId: string;
  email: string;
  baseUrl: string;
  createdAt: string;
}

export function pendingSignupPath(home: string = os.homedir()): string {
  return path.join(home, '.delegance', 'pending-signup.json');
}

export function savePendingSignup(p: PendingSignup, home?: string): void {
  const file = pendingSignupPath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Never follow a planted symlink: the file holds the device secret.
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`${file} is a symlink; refusing to write the signup secret there`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  // Write a fresh 0600 file (O_EXCL, so no pre-existing file or link is
  // reused), then rename it into place.
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(p, null, 2));
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function loadPendingSignup(home?: string): PendingSignup | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingSignupPath(home), 'utf8'));
    return parsed && typeof parsed.enrollmentId === 'string' && typeof parsed.deviceSecret === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearPendingSignup(home?: string): void {
  try {
    fs.unlinkSync(pendingSignupPath(home));
  } catch {
    // Already gone.
  }
}
