/**
 * Turns pushed events into an async iterable, so a callback-based library can be consumed with
 * `for await`. Baileys emits through an EventEmitter; the ChannelProvider port exposes streams.
 *
 * Buffers when nothing is reading yet, so events arriving during startup are not lost — the
 * previous system dropped inbound messages whenever a webhook had not been registered in time
 * (docs/00-prior-art.md, M29).
 */
export class EventStream<T> {
  readonly #buffer: T[] = [];
  readonly #waiting: Array<(result: IteratorResult<T>) => void> = [];
  #closed = false;

  /** Pushes an event to whoever is reading, or buffers it until someone is. */
  push(event: T): void {
    if (this.#closed) return;
    const waiter = this.#waiting.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.#buffer.push(event);
  }

  /** Ends the stream. Every pending and future reader completes rather than hanging. */
  close(): void {
    this.#closed = true;
    while (this.#waiting.length > 0) {
      this.#waiting.shift()?.({ value: undefined, done: true });
    }
  }

  /** How many events are buffered — exposed so a consumer can notice it falling behind. */
  get pending(): number {
    return this.#buffer.length;
  }

  /** Yields buffered events first, then waits for new ones, until the stream is closed. */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const buffered = this.#buffer.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }
      if (this.#closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => this.#waiting.push(resolve));
      if (next.done === true) return;
      yield next.value;
    }
  }
}
