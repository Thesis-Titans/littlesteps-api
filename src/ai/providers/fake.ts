import type { AiProvider } from "./provider.js";

type Script = (prompt: string, signal: AbortSignal) => unknown | Promise<unknown>;

/** Scriptable provider for tests. No network. */
export class FakeProvider implements AiProvider {
  readonly model = "fake-model";
  calls = 0;
  prompts: string[] = [];

  constructor(private readonly script: Script) {}

  async suggest(prompt: string, signal: AbortSignal): Promise<unknown> {
    this.calls += 1;
    this.prompts.push(prompt);
    return this.script(prompt, signal);
  }

  static valid(picks: Array<{ id: string; why?: string }>): FakeProvider {
    return new FakeProvider(() => ({ picks: picks.map((p) => ({ id: p.id, why: p.why ?? "Fits the time you have." })) }));
  }
  static inventedId(): FakeProvider {
    return FakeProvider.valid([{ id: "not-in-catalog" }]);
  }
  static duplicate(id: string): FakeProvider {
    return FakeProvider.valid([{ id }, { id }]);
  }
  static overLength(id: string): FakeProvider {
    return FakeProvider.valid([{ id, why: "x".repeat(141) }]);
  }
  static denylistHit(id: string): FakeProvider {
    return FakeProvider.valid([{ id, why: "Helps if your child is delayed." }]);
  }
  static malformed(): FakeProvider {
    return new FakeProvider(() => "not json at all");
  }
  static throws(): FakeProvider {
    return new FakeProvider(() => {
      throw new Error("provider failure");
    });
  }
  static hangs(): FakeProvider {
    return new FakeProvider((_prompt, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }));
  }
}
