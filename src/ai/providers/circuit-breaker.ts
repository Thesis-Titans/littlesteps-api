import type { AiProvider } from "./provider.js";

export const FAILURE_THRESHOLD = 3;
export const OPEN_MS = 60_000;

/**
 * After 3 consecutive failures the provider is skipped for 60 seconds (callers fall back to the
 * catalog). Then one trial call is let through (half-open): success closes the breaker, failure reopens it.
 * shortcut: state is per instance, like the IP rate limit.
 */
export class CircuitBreakerProvider implements AiProvider {
  private failures = 0;
  private openUntil = 0;
  private trialInFlight = false;

  constructor(private readonly inner: AiProvider, private readonly now: () => number = Date.now) {}

  get model(): string {
    return this.inner.model;
  }

  async suggest(prompt: string, signal: AbortSignal): Promise<unknown> {
    const halfOpen = this.failures >= FAILURE_THRESHOLD;
    if (halfOpen && (this.now() < this.openUntil || this.trialInFlight)) throw new Error("circuit open");
    if (halfOpen) this.trialInFlight = true;
    const isTrial = halfOpen; // only the half-open trial may clear the flag; older overlapping calls must not
    try {
      const reply = await this.inner.suggest(prompt, signal);
      this.failures = 0;
      return reply;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= FAILURE_THRESHOLD) this.openUntil = this.now() + OPEN_MS;
      throw error;
    } finally {
      if (isTrial) this.trialInFlight = false;
    }
  }
}
