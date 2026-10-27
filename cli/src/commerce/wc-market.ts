/**
 * Workers' comp state-market lines for `quote start`. The server sends
 * `wcMarket` on a session that requested workers' comp; this turns it into
 * plain lines. Reads the field defensively so an older SDK type or an older
 * server (no field) prints nothing.
 */

interface WcMarketLike {
  states?: { summary?: unknown }[];
  privateWcQuote?: unknown;
  message?: unknown;
  unknownStates?: unknown;
}

export function wcMarketLines(session: unknown): string[] {
  const wc = (session as { wcMarket?: WcMarketLike } | null)?.wcMarket;
  if (!wc || typeof wc !== 'object') return [];
  const lines: string[] = [];
  if ((wc.privateWcQuote === 'skipped' || wc.privateWcQuote === 'broker')
    && typeof wc.message === 'string' && wc.message) {
    lines.push(wc.message);
  }
  for (const s of Array.isArray(wc.states) ? wc.states : []) {
    if (typeof s?.summary === 'string' && s.summary) lines.push(s.summary);
  }
  const unknown = Array.isArray(wc.unknownStates)
    ? wc.unknownStates.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (unknown.length > 0) {
    lines.push(`Unrecognized state on file: ${unknown.join(', ')}. A broker will confirm it.`);
  }
  if (lines.length === 0 && Array.isArray(wc.states) && wc.states.length === 0) {
    lines.push("No business address on file, so workers' comp state rules were not checked. Add one in the portal and start again.");
  }
  return lines;
}
