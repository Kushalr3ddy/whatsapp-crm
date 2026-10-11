/**
 * Why a link attempt failed, in words an operator can act on.
 *
 * The gateway stores one of these as JSON in `channel_session.link_error`; the API hands it on and the
 * Numbers page renders it. A plain legacy string still decodes (as `unknown`), so rows written before
 * this existed show a message instead of breaking the page.
 */
export type LinkErrorCode =
  | 'qr_timeout'          // the socket opened but WhatsApp never sent a QR
  | 'stale_session'       // saved credentials were refused (logged out on the phone, or revoked)
  | 'connection_closed'   // the connection dropped before a QR arrived
  | 'rate_limited'        // WhatsApp is throttling link attempts for this number or network
  | 'needs_phone'         // pairing-code mode without a phone number
  | 'gateway_error'       // something inside our own gateway
  | 'unknown';

/** A classified failure: a short title, one plain sentence, and what to do next. */
export interface LinkErrorInfo {
  readonly code: LinkErrorCode;
  readonly title: string;
  readonly summary: string;
  readonly hint: string;
  /** WhatsApp's own close code when there was one (401, 428, 515…), for support and the log. */
  readonly statusCode?: number | null;
  readonly at?: string;
}

const COPY: Record<LinkErrorCode, Omit<LinkErrorInfo, 'code' | 'statusCode' | 'at'>> = {
  qr_timeout: {
    title: 'WhatsApp did not send a QR code',
    summary: 'The connection to WhatsApp opened, but no QR code arrived before the time limit.',
    hint: 'Try again in a minute. If it keeps happening, check this machine\'s internet and that the gateway is running, then unlink the number and link it again.'
  },
  stale_session: {
    title: 'WhatsApp refused the saved login',
    summary: 'This number was unlinked or logged out on the phone, so the saved session is no longer valid.',
    hint: 'The old session has been cleared. Press Link again to get a fresh QR code. If you did not unlink it yourself, check the phone: WhatsApp may have restricted the number.'
  },
  connection_closed: {
    title: 'The connection to WhatsApp dropped',
    summary: 'WhatsApp closed the connection before a QR code could be shown.',
    hint: 'Press Link to try again. Repeated drops can mean a network problem or a temporary block on this number.'
  },
  rate_limited: {
    title: 'WhatsApp is limiting link attempts',
    summary: 'Too many link attempts in a short time, so WhatsApp is asking this number to wait.',
    hint: 'Wait at least 30 minutes before trying again. Do not retry in a loop.'
  },
  needs_phone: {
    title: 'A phone number is needed',
    summary: 'Pairing-code mode needs the number being linked.',
    hint: 'Enter the number in full international form, for example +919876543210, or use the QR code instead.'
  },
  gateway_error: {
    title: 'The gateway hit an internal error',
    summary: 'Something failed inside our own gateway while linking.',
    hint: 'Look at the gateway log for the cause, then try again.'
  },
  unknown: {
    title: 'Linking failed',
    summary: 'The link attempt failed for a reason we did not recognise.',
    hint: 'Try again. If it repeats, send the gateway log to whoever runs this install.'
  }
};

/** Builds the full message for a code. */
export function linkErrorFor(code: LinkErrorCode, extra: { statusCode?: number | null; at?: Date } = {}): LinkErrorInfo {
  return {
    code, ...COPY[code],
    ...(extra.statusCode !== undefined ? { statusCode: extra.statusCode } : {}),
    at: (extra.at ?? new Date()).toISOString()
  };
}

/** Maps whatever a link attempt threw (or a raw WhatsApp close code) onto a code. */
export function classifyLinkFailure(input: unknown): LinkErrorInfo {
  const err = input as { code?: unknown; statusCode?: unknown; message?: unknown } | null;
  const typed = typeof err?.code === 'string' && err.code in COPY ? (err.code as LinkErrorCode) : null;
  const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : null;
  if (typed !== null) return linkErrorFor(typed, { statusCode });
  const message = typeof err?.message === 'string' ? err.message : String(input);
  if (statusCode === 401 || /logged.?out|401/i.test(message)) return linkErrorFor('stale_session', { statusCode: statusCode ?? 401 });
  if (statusCode === 429 || /rate.?limit|429|too many/i.test(message)) return linkErrorFor('rate_limited', { statusCode: statusCode ?? 429 });
  if (/within the timeout|did not issue a qr/i.test(message)) return linkErrorFor('qr_timeout');
  if (/pairing_code mode needs/i.test(message)) return linkErrorFor('needs_phone');
  if (/connection (closed|failure|lost)|stream errored/i.test(message)) return linkErrorFor('connection_closed', { statusCode });
  return { ...linkErrorFor('unknown'), summary: `Linking failed: ${message.slice(0, 160)}` };
}

/** Serialises for `channel_session.link_error`. */
export function encodeLinkError(info: LinkErrorInfo): string {
  return JSON.stringify(info);
}

/** Reads a stored value; a legacy plain string becomes an `unknown` entry carrying that text. */
export function decodeLinkError(stored: string | null): LinkErrorInfo | null {
  if (stored === null || stored === '') return null;
  try {
    const parsed = JSON.parse(stored) as Partial<LinkErrorInfo>;
    if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string' && typeof parsed.summary === 'string') {
      return parsed as LinkErrorInfo;
    }
  } catch { /* a legacy plain string */ }
  return classifyLinkFailure(new Error(stored));
}
