/**
 * Typing simulation — P6 anti-ban, the human-rhythm layer (docs/08-antiban.md, D-24).
 *
 * Layers 1–2 decide *how much* a number sends, circadian decides *when*, the contact-graph gate
 * decides *to whom*. This is the smallest, most cosmetic layer: it makes each individual send
 * *look* human. A real person sees the "typing…" bubble for a beat before a message lands; a bot
 * fires instantly with no bubble, and an instant zero-delay send is a documented tell. So before
 * a send the gateway emits a `composing` presence, waits a beat proportional to the message
 * length, then sends — this module computes only that beat.
 *
 * Pure and side-effect-free on purpose: it takes a length and returns milliseconds, so it is
 * unit-testable without a socket, and the gateway owns the actual presence calls and the sleep.
 */

/**
 * Milliseconds "spent typing" per character, and its spread. Gaussian around the mean because
 * uniform random is itself a detectable signature (the same reason the inter-send jitter is).
 *
 * This is a **compressed** beat, not literal typing time. docs/08-antiban.md frames the layer as
 * ~45 WPM, which for a paragraph is 30-plus seconds — realistic to *type*, but a half-minute
 * "typing…" bubble before every send would stall a paced queue for no anti-ban gain (the tell we
 * are removing is the *instant* send, not a fast one). So the rate is tuned to a plausible pause
 * that stays inside the clamp window for ordinary message lengths and only saturates for very
 * long bodies.
 */
const MS_PER_CHAR_MEAN = 28;
const MS_PER_CHAR_SIGMA = 8;
/** Clamp the drawn per-char rate to a believable band, so an outlier draw is not absurd. */
const MS_PER_CHAR_MIN = 12;
const MS_PER_CHAR_MAX = 55;
/**
 * Floor and ceiling on the beat. The floor keeps even a one-word reply from sending instantly
 * (the tell we are avoiding); the ceiling keeps a long body from parking the send behind several
 * seconds of fake typing — realism is not worth stalling the queue for.
 */
const TYPING_MIN_MS = 700;
const TYPING_MAX_MS = 8_000;

/**
 * How long to show "typing…" before sending a message of the given length.
 *
 * Box–Muller draws a per-character rate around {@link MS_PER_CHAR_MEAN}, clamped to a human band,
 * and the beat is that rate times the length — then clamped to
 * [{@link TYPING_MIN_MS}, {@link TYPING_MAX_MS}]. Longer messages take longer, on average, with
 * genuine per-send variation so the pause is never a fixed interval.
 *
 * `random` is injectable so a test can make the beat deterministic; production passes `Math.random`.
 */
export function typingDelayMs(bodyLength: number, random: () => number = Math.random): number {
  if (bodyLength <= 0) return TYPING_MIN_MS;

  // Three sigma across the spread, so a clamp to the rate band is rare rather than the common case.
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const msPerChar = Math.min(
    MS_PER_CHAR_MAX, Math.max(MS_PER_CHAR_MIN, MS_PER_CHAR_MEAN + gauss * (MS_PER_CHAR_SIGMA / 3))
  );

  const ms = bodyLength * msPerChar;
  return Math.round(Math.min(TYPING_MAX_MS, Math.max(TYPING_MIN_MS, ms)));
}
