import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../../src/ai/providers/gemini.js";
import { CircuitBreakerProvider, OPEN_MS } from "../../src/ai/providers/circuit-breaker.js";
import { createConfiguredProvider } from "../../src/ai/providers/configure.js";
import { FakeProvider } from "../../src/ai/providers/fake.js";
import { recommend } from "../../src/ai/ai-service.js";
import { setApprovedActivitiesForTest, setCatalogActivities } from "../../src/catalog/catalog-service.js";
import { approved, baseRequest } from "./helpers.js";

const KEY = "AIza-test-key-never-log-me";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const reply = (text: string, finishReason = "STOP") => json({ candidates: [{ finishReason, content: { parts: [{ text }] } }] });
const mockFetch = (impl: () => Promise<Response>) => vi.fn(impl) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const signal = () => new AbortController().signal;

let logs: unknown[][];
beforeEach(() => {
  logs = [];
  for (const m of ["log", "info", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a) => { logs.push(a); });
});
afterEach(() => {
  vi.restoreAllMocks();
  setCatalogActivities([]);
});

describe("GeminiProvider", () => {
  it("sends the prompt with the key in a header and the expected generation settings", async () => {
    const f = mockFetch(async () => reply('{"picks":[{"id":"a","why":"Fits."}]}'));
    const out = await new GeminiProvider(KEY, "model-x", f).suggest("the prompt", signal());
    expect(out).toEqual({ picks: [{ id: "a", why: "Fits." }] });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/model-x:generateContent");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "the prompt" }] }]);
    expect(body.generationConfig).toMatchObject({ temperature: 0.2, maxOutputTokens: 1024, responseMimeType: "application/json" });
    expect(body.generationConfig.responseSchema.required).toEqual(["picks"]);
    expect(body.safetySettings).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["invalid JSON text", () => reply("not json")],
    ["safety block with no candidates", () => json({ promptFeedback: { blockReason: "SAFETY" } })],
    ["non-STOP finish", () => reply('{"picks":[]}', "SAFETY")],
    ["HTTP 429", () => json({ error: { message: `quota for ${KEY}` } }, 429)],
    ["HTTP 500", () => json({ error: { message: `oops ${KEY}` } }, 500)]
  ])("throws a key-free GeminiError on %s", async (_name, make) => {
    const f = mockFetch(async () => make());
    const error = await new GeminiProvider(KEY, "m", f).suggest("p", signal()).catch((e: unknown) => e as Error);
    expect(error.name).toBe("GeminiError");
    expect(`${error.message}${error.stack}`).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it("rejects a reply whose content-length exceeds 64KB", async () => {
    const f = mockFetch(async () => new Response("{}", { headers: { "content-length": String(64 * 1024 + 1) } }));
    const error = await new GeminiProvider(KEY, "m", f).suggest("p", signal()).catch((e: unknown) => e as Error);
    expect(error.name).toBe("GeminiError");
    expect(error.message).toBe("Gemini reply was too large");
  });

  it("stops reading a body over 64KB when no content-length is sent", async () => {
    const f = mockFetch(async () => new Response("x".repeat(64 * 1024 + 1)));
    const error = await new GeminiProvider(KEY, "m", f).suggest("p", signal()).catch((e: unknown) => e as Error);
    expect(error.message).toBe("Gemini reply was too large");
  });

  it("does not leak the key when fetch fails or is aborted", async () => {
    const f = mockFetch(async () => { throw new Error(`connect failed using ${KEY}`); });
    const error = await new GeminiProvider(KEY, "m", f).suggest("p", signal()).catch((e: unknown) => e as Error);
    expect(error.name).toBe("GeminiError");
    expect(error.message).not.toContain(KEY);
  });

  it("passes the abort signal so a timeout stops the request, and the endpoint falls back", async () => {
    setApprovedActivitiesForTest([approved({ id: "a" })]);
    const f = mockFetch(() => new Promise<Response>((_res, rej) => {
      const s = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].signal as AbortSignal;
      s.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
    }));
    const res = await recommend({ ...baseRequest, setting: "either", materials: [], count: 3 }, new GeminiProvider(KEY, "m", f), 20);
    expect(res.source).toBe("catalog_fallback");
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it("returns an AI response end to end and logs no prompt, reply or key", async () => {
    setApprovedActivitiesForTest([approved({ id: "a" })]);
    const f = mockFetch(async () => reply('{"picks":[{"id":"a","why":"Fits the time you have."}]}'));
    const res = await recommend({ ...baseRequest, setting: "either", materials: [], count: 3 }, new GeminiProvider(KEY, "m", f));
    expect(res.source).toBe("ai");
    expect(res.provenance.model).toBe("m");
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("Fits the time");
  });
});

describe("createConfiguredProvider", () => {
  it.each([[{}], [{ GEMINI_API_KEY: KEY }], [{ GEMINI_MODEL: "m" }], [{ GEMINI_API_KEY: " ", GEMINI_MODEL: "m" }], [{ GEMINI_API_KEY: KEY, GEMINI_MODEL: "a/../b" }]])(
    "is not configured for %j", (env) => {
      expect(createConfiguredProvider(env)).toBeNull();
    }
  );
  it("is configured when both are set", () => {
    expect(createConfiguredProvider({ GEMINI_API_KEY: KEY, GEMINI_MODEL: "m" })?.model).toBe("m");
  });
});

describe("CircuitBreakerProvider", () => {
  let now = 0;
  let ok = false;
  let inner: FakeProvider;
  let breaker: CircuitBreakerProvider;
  beforeEach(() => {
    now = 1000;
    ok = false;
    inner = new FakeProvider(() => { if (!ok) throw new Error("boom"); return { picks: [] }; });
    breaker = new CircuitBreakerProvider(inner, () => now);
  });

  it("opens after 3 consecutive failures, then lets one trial through after 60 seconds", async () => {
    for (let n = 0; n < 3; n++) await expect(breaker.suggest("p", signal())).rejects.toThrow("boom");
    await expect(breaker.suggest("p", signal())).rejects.toThrow("circuit open");
    expect(inner.calls).toBe(3);

    now += OPEN_MS - 1;
    await expect(breaker.suggest("p", signal())).rejects.toThrow("circuit open");
    now += 1;
    await expect(breaker.suggest("p", signal())).rejects.toThrow("boom"); // trial fails: reopen
    expect(inner.calls).toBe(4);
    await expect(breaker.suggest("p", signal())).rejects.toThrow("circuit open");

    now += OPEN_MS;
    ok = true;
    await expect(breaker.suggest("p", signal())).resolves.toEqual({ picks: [] }); // trial succeeds: closed
    await expect(breaker.suggest("p", signal())).resolves.toBeDefined();
    expect(inner.calls).toBe(6);
  });

  it("resets the count after a success", async () => {
    await expect(breaker.suggest("p", signal())).rejects.toThrow();
    await expect(breaker.suggest("p", signal())).rejects.toThrow();
    ok = true;
    await breaker.suggest("p", signal());
    ok = false;
    await expect(breaker.suggest("p", signal())).rejects.toThrow("boom");
    await expect(breaker.suggest("p", signal())).rejects.toThrow("boom");
    expect(inner.calls).toBe(5);
  });

  it("keeps the endpoint answering with the fallback while open", async () => {
    setApprovedActivitiesForTest([approved({ id: "a" })]);
    for (let n = 0; n < 5; n++) {
      const res = await recommend({ ...baseRequest, setting: "either", materials: [], count: 3 }, breaker);
      expect(res.source).toBe("catalog_fallback");
    }
    expect(inner.calls).toBe(3);
  });
});

describe("CircuitBreakerProvider overlap", () => {
  it("does not admit a second trial when a call started before opening finishes during the trial", async () => {
    let clock = 0;
    let hang = true;
    const gates: Array<{ reject: () => void; resolve: () => void }> = [];
    const inner = {
      model: "m",
      suggest: () =>
        hang
          ? new Promise<unknown>((resolve, reject) => gates.push({ resolve: () => resolve("ok"), reject: () => reject(new Error("late")) }))
          : Promise.reject(new Error("down"))
    };
    const breaker = new CircuitBreakerProvider(inner, () => clock);
    const older = breaker.suggest("p", signal()).catch(() => undefined); // starts while closed
    hang = false;
    for (let i = 0; i < 3; i++) await breaker.suggest("p", signal()).catch(() => undefined); // opens it
    hang = true;
    clock += OPEN_MS;
    const trial = breaker.suggest("p", signal()).catch(() => undefined); // half-open trial
    expect(gates.length).toBe(2);
    gates[0]!.reject(); // the older call fails while the trial runs
    await older;
    clock += OPEN_MS; // old breaker deadline has passed again
    await expect(breaker.suggest("p", signal())).rejects.toThrow("circuit open");
    expect(gates.length).toBe(2);
    gates[1]!.resolve();
    await trial;
  });
});
