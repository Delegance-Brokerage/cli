/**
 * Open a URL in the user's browser, best effort. The URL goes as a single
 * argv entry to a platform opener (never through a shell), and only http(s)
 * URLs are opened. Returns false when nothing could be launched; callers
 * always print the URL too.
 */
import { spawn } from 'child_process';

export function openerFor(platform: NodeJS.Platform): { cmd: string; args: string[] } {
  if (platform === 'darwin') return { cmd: 'open', args: [] };
  if (platform === 'win32') return { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler'] };
  return { cmd: 'xdg-open', args: [] };
}

export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const { cmd, args } = openerFor(platform);
  try {
    const child = spawn(cmd, [...args, parsed.toString()], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
    return true;
  } catch {
    return false;
  }
}
