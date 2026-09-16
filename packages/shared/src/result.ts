/**
 * A success carrying a value. Used for operations whose failure is expected and
 * meaningful — a malformed phone number is data, not an exception.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };

/** A failure carrying a machine-readable reason and a human-readable message. */
export type Err<E extends string> = { readonly ok: false; readonly reason: E; readonly message: string };

/**
 * The result of an operation that can fail in an anticipated way. Unexpected failures
 * still throw; this is for outcomes a caller is expected to handle, such as a row that
 * cannot be parsed during an import (docs/07-ingestion.md).
 */
export type Result<T, E extends string> = Ok<T> | Err<E>;

/** Wraps a value as a success. */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

/** Wraps a reason code and message as a failure. */
export function err<E extends string>(reason: E, message: string): Err<E> {
  return { ok: false, reason, message };
}
