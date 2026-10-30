import { describe, expect, it } from "vitest";
import { cleanMaterials } from "../../src/ai/sanitize.js";
import { rankActivities } from "../../src/ai/fallback.js";
import { validateOutput } from "../../src/ai/validate-output.js";
import { buildPrompt } from "../../src/ai/prompt.js";
import { RecommendationRequestSchema } from "../../src/ai/types.js";
import { approved } from "./helpers.js";

describe("cleanMaterials", () => {
  it("lowercases, trims, strips control/format chars, truncates, dedupes, drops empties", () => {
    const long = "a".repeat(40) + "zzz";
    expect(cleanMaterials(["  Blocks ", "BLOCKS", "pa\u0000per​", "\n\t", "", long])).toEqual([
      "blocks", "paper", "a".repeat(40)
    ]);
  });
});

describe("cleanMaterials unicode", () => {
  it("turns all separators into one space", () => {
    expect(cleanMaterials(["a\u2028b\u2029c\u00a0 d"])).toEqual(["a b c d"]);
  });
  it("does not split a surrogate pair at the cut", () => {
    const out = cleanMaterials(["a".repeat(39) + "😀😀"]);
    expect(out).toEqual(["a".repeat(39) + "😀"]);
  });
});

describe("validateOutput", () => {
  const ids = new Set(["a", "b", "c"]);
  const ok = { picks: [{ id: "a", why: "Fits the time you have." }] };
  it("accepts a valid reply", () => expect(validateOutput(ok, ids, 3)).toHaveLength(1));
  it.each([
    ["invented id", { picks: [{ id: "zzz", why: "ok" }] }],
    ["duplicate id", { picks: [{ id: "a", why: "ok" }, { id: "a", why: "ok" }] }],
    ["too many picks", { picks: [{ id: "a", why: "ok" }, { id: "b", why: "ok" }] }],
    ["why too long", { picks: [{ id: "a", why: "x".repeat(141) }] }],
    ["denylist term", { picks: [{ id: "a", why: "Good for a developmental delay." }] }],
    ["denylist prefix", { picks: [{ id: "a", why: "Autistic children enjoy it." }] }],
    ["zero-width in delay", { picks: [{ id: "a", why: "Not a de\u200blay." }] }],
    ["cyrillic lookalike", { picks: [{ id: "a", why: "Not a d\u0435lay." }] }],
    ["hyphenated", { picks: [{ id: "a", why: "Not a de-lay." }] }],
    ["underscored", { picks: [{ id: "a", why: "Not a de_lay." }] }],
    ["double space phrase", { picks: [{ id: "a", why: "A screening  score." }] }],
    ["newline phrase", { picks: [{ id: "a", why: "A red\nflag." }] }],
    ["developmental concern", { picks: [{ id: "a", why: "A developmental concern." }] }],
    ["empty why", { picks: [{ id: "a", why: "" }] }],
    ["whitespace-only why", { picks: [{ id: "a", why: "   " }] }],
    ["html", { picks: [{ id: "a", why: "Try <b>this</b>." }] }],
    ["url", { picks: [{ id: "a", why: "See https://example.com now." }] }],
    ["www", { picks: [{ id: "a", why: "See www.example.com now." }] }],
    ["empty picks", { picks: [] }],
    ["malformed", "nope"],
    ["wrong shape", { picks: [{ id: 1 }] }]
  ])("rejects %s", (_name, reply) => {
    expect(validateOutput(reply, ids, 1)).toBeNull();
  });
});

describe("validateOutput harmless wording", () => {
  const ids = new Set(["a"]);
  it.each(["A fun treat for you both.", "Hide behind the couch and peek out."])("accepts %s", (why) => {
    expect(validateOutput({ picks: [{ id: "a", why }] }, ids, 1)).toHaveLength(1);
  });
});

describe("rankActivities", () => {
  const req = { ageBand: "12-23m", language: "en", setting: "indoor", timeMinutes: 30, count: 3, domain: "motor" } as const;
  it("filters by band, language, setting (either matches) and duration", () => {
    const items = [
      approved({ id: "ok-either", setting: "either" }),
      approved({ id: "wrong-band", ageBand: "0-5m" }),
      approved({ id: "wrong-lang", language: "fil" }),
      approved({ id: "outdoor", setting: "outdoor" }),
      approved({ id: "too-long", durationMinutes: 31 })
    ];
    expect(rankActivities(items, req, []).map((i) => i.id)).toEqual(["ok-either"]);
  });
  it("orders by domain, material overlap, shorter duration, then id; stable across input order", () => {
    const items = [
      approved({ id: "d", domain: "cognitive", durationMinutes: 5 }),
      approved({ id: "c", domain: "motor", durationMinutes: 20 }),
      approved({ id: "b", domain: "motor", durationMinutes: 10, materials: ["ball"] }),
      approved({ id: "a", domain: "motor", durationMinutes: 10, materials: ["ball"] }),
      approved({ id: "e", domain: "motor", durationMinutes: 10, materials: ["ball", "cup"] })
    ];
    const expected = ["e", "a", "b"];
    expect(rankActivities(items, req, ["ball", "cup"]).map((i) => i.id)).toEqual(expected);
    expect(rankActivities([...items].reverse(), req, ["ball", "cup"]).map((i) => i.id)).toEqual(expected);
    expect(rankActivities(items, { ...req, count: 5 }, []).map((i) => i.id)).toEqual(["a", "b", "e", "c", "d"]);
  });
});

describe("buildPrompt", () => {
  it("contains only the allowed context", () => {
    const prompt = buildPrompt({
      ageBand: "12-23m", timeMinutes: 20, setting: "indoor", materials: ["blocks"], language: "en", count: 3,
      candidates: [{ id: "a", title: "T", domain: "motor", materials: ["blocks"] }]
    });
    expect(prompt).toContain("12-23m");
    expect(prompt).toContain("blocks");
    for (const word of ["nickname", "birth", "notes", "uid", "email", "ip "]) {
      expect(prompt.toLowerCase()).not.toContain(word);
    }
  });
});

describe("RecommendationRequestSchema", () => {
  const base = { ageBand: "12-23m", timeMinutes: 20, language: "en" };
  it("applies defaults", () => {
    expect(RecommendationRequestSchema.parse(base)).toMatchObject({ setting: "either", count: 3, materials: [] });
  });
  it.each([
    { timeMinutes: 4 }, { timeMinutes: 121 }, { timeMinutes: 5.5 }, { count: 0 }, { count: 4 },
    { materials: Array(11).fill("a") }, { materials: ["a".repeat(41)] }, { childId: "x" }
  ])("rejects %j", (extra) => {
    expect(RecommendationRequestSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });
  it("accepts bounds", () => {
    expect(RecommendationRequestSchema.safeParse({ ...base, timeMinutes: 5, count: 1, materials: Array(10).fill("a".repeat(40)) }).success).toBe(true);
    expect(RecommendationRequestSchema.safeParse({ ...base, timeMinutes: 120 }).success).toBe(true);
  });
});
