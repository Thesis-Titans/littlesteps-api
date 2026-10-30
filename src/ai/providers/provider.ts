export interface AiProvider {
  /** Returns the raw, unvalidated reply. Must stop work when the signal aborts. */
  suggest(prompt: string, signal: AbortSignal): Promise<unknown>;
  /** Model name reported in provenance. */
  readonly model: string;
}
