/**
 * Every number the anti-ban engine uses, in one place (F6). Each one marked *guess* has no data behind it; it is a
 * threshold someone has to tune, which is why it is a named constant and why every decision that uses one is logged with
 * its inputs (AC-1.8). Nothing here is a daily cap: there are none, by decision.
 */

// ── the lane (S1) ───────────────────────────────────────────────────────────────────────────────────
/** The shortest wait between two sends from one number, in ms. The gap is uniform between this and the maximum. */
export const GAP_MIN_MS = 1_000;
/** The longest wait between two sends from one number, in ms. */
export const GAP_MAX_MS = 50_000;
/** A silence this long ends a "run": the next message is the first of a new one and goes without a gap. */
export const RUN_BREAK_MS = 90_000;

/** Typing time per character (*guess*). */
export const TYPING_MS_PER_CHAR = 60;
/** The shortest "typing…" shown before a send (*guess*). */
export const TYPING_MIN_MS = 2_000;
/** The longest "typing…" shown before a send (*guess*). */
export const TYPING_MAX_MS = 25_000;
/** How often `composing` is sent again while typing goes on (*guess*; WhatsApp clears the bubble after a few seconds). */
export const TYPING_REFRESH_MS = 5_000;

/** Silence after which the number is shown offline again (*guess*). */
export const PRESENCE_IDLE_MS = 90_000;

/** An inbound message is marked read at least this long before the reply to it starts typing (*guess*). */
export const READ_LEAD_MIN_MS = 3_000;
/** … and at most this long before (*guess*). */
export const READ_LEAD_MAX_MS = 20_000;

/** An inbound message from the last 24 hours makes the answer a "reply" and puts it first in the lane. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Campaign messages waiting in the lane per number at any one time, so a campaign never buries a reply. */
export const CAMPAIGN_QUEUE_AHEAD = 20;

// ── WhatsApp's warnings (S2) ────────────────────────────────────────────────────────────────────────
/** Gap multiplier for new chats at the cap's first warning (*guess*). */
export const FIRST_WARNING_GAP_FACTOR = 2;
/** Gap multiplier for new chats at the cap's second warning (*guess*). */
export const SECOND_WARNING_GAP_FACTOR = 3;

// ── extra protection (S7) ───────────────────────────────────────────────────────────────────────────
/** How long a "has a WhatsApp account" answer is trusted. */
export const REGISTERED_CACHE_MS = 30 * 24 * 60 * 60 * 1000;

/** The reaction brake looks at this many of the number's latest new-chat sends. */
export const BRAKE_WINDOW = 50;
/** Brake: this share of them (or more) probably blocked us (*guess*). */
export const BRAKE_BLOCKED_RATIO = 0.1;
/** Brake: with at least this many sent … (*guess*) */
export const BRAKE_MIN_SENT = 30;
/** … fewer than this share replied (*guess*). */
export const BRAKE_REPLY_RATIO = 0.05;
/** Gap multiplier for new chats while the brake is on (*guess*). */
export const BRAKE_GAP_FACTOR = 2;

/** Quiet hours when the org has not set its own. */
export const QUIET_HOURS_DEFAULT_START = '22:00';
/** … and when they end. */
export const QUIET_HOURS_DEFAULT_END = '08:00';
/** The time zone quiet hours are read in when the org has not set one. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** A number linked fewer days ago than this gets the "go gentle" hint. */
export const NEW_NUMBER_DAYS = 7;

// ── after the send: ticks, offline or blocked (S4) ──────────────────────────────────────────────────
/** A message still at one tick this long after sending is looked at by the sweep (*guess*). */
export const TICK_CHECK_AFTER_MS = 30 * 60 * 1000;
/** A contact's profile photo and about are probed at most this often (*guess*). */
export const PROFILE_PROBE_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** A snapshot taken at a delivery is renewed after this long, so the next delivery does not probe again (*guess*). */
export const PROFILE_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A contact "delivers fast" when one of their last 3 messages from us was delivered within this long (*guess*). */
export const FAST_DELIVERY_MS = 5 * 60 * 1000;
/** … looking back this many messages (*guess*). */
export const FAST_DELIVERY_LOOKBACK = 3;
/** Many stuck: the number's latest sends to distinct fast-delivering contacts that are looked at (*guess*). */
export const STUCK_WINDOW = 20;
/** … this many or more still at one tick holds the number's campaigns (*guess*). */
export const STUCK_HOLD_AT = 8;
/** … and the hold lifts when the count falls below this (*guess*). */
export const STUCK_LIFT_BELOW = 4;
/** How many stuck messages one sweep judges per number, so a backlog never turns into a burst of probes. */
export const TICK_SWEEP_BATCH = 50;

// ── never "Waiting for this message" (S5) ───────────────────────────────────────────────────────────
/** Retries from this many different contacts … (*guess*) */
export const RETRY_WAVE_CONTACTS = 3;
/** … within this long hold the whole number (*guess*). */
export const RETRY_WAVE_WINDOW_MS = 10 * 60 * 1000;
/** A second retry for the same message recreates the session with that contact. */
export const RETRY_RESET_AT = 2;

// ── replies, STOP and the closing message (S6) ──────────────────────────────────────────────────────
/** Words that opt a contact out, matched against the whole message. The org's own list is added to these. */
export const DEFAULT_STOP_WORDS: readonly string[] = ['stop', 'unsubscribe', 'opt out'];
/** Words that lift do-not-contact when the contact sends them. The org's own list is added to this. */
export const DEFAULT_RESTART_WORDS: readonly string[] = ['start'];
/** The closing message quotes at most this much of what was last sent, on one line (*guess*). */
export const CLOSING_SUMMARY_MAX_CHARS = 120;
/** The classifier reads at most this much of a contact's message (*guess*). */
export const CLASSIFIER_MAX_CHARS = 500;
/** Marks the closing message on the message's `dnc_override_reason`: it goes past the do-not-contact gate it sets, and at reply priority. */
export const CLOSING_MESSAGE_MARK = 'opt_out_closing';
/** The classifier waits this long for the model before giving up, so a slow model never holds up the inbound stream (*guess*). */
export const CLASSIFIER_TIMEOUT_MS = 8_000;
/** At most this many profile probes per number in one sweep, so a backlog never becomes a stream of lookups (*guess*). */
export const PROBES_PER_SWEEP = 5;
