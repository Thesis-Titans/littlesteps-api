import { describe, expect, it } from "vitest";
import { AgeRangeError, assertBirthMonthInRange, bandForMonths, deriveAgeBand, monthsBetween } from "../src/children/age.js";
import { applyUpdate, toPublic, toStored } from "../src/children/mapping.js";
import { createMemoryChildrenStore, LIST_LIMIT } from "../src/children/children-store.js";
import { CreateChildSchema, UpdateChildSchema, toErrorDetails } from "../src/children/schemas.js";

const NOW = new Date("2026-10-15T12:00:00Z");

describe("age bands", () => {
  it.each([
    [0, "0-5m"], [5, "0-5m"], [6, "6-11m"], [11, "6-11m"], [12, "12-23m"], [23, "12-23m"],
    [24, "24-35m"], [35, "24-35m"], [36, "36-47m"], [47, "36-47m"], [48, "48-59m"], [59, "48-59m"],
    [60, "60-71m"], [71, "60-71m"]
  ])("%i months is %s", (n, band) => {
    expect(bandForMonths(n)).toBe(band);
  });

  it("accepts 0 and 71 months, rejects 72 and future", () => {
    expect(() => assertBirthMonthInRange("2026-10", NOW)).not.toThrow();
    expect(() => assertBirthMonthInRange("2020-11", NOW)).not.toThrow(); // 71
    expect(() => assertBirthMonthInRange("2020-10", NOW)).toThrow(AgeRangeError); // 72
    expect(() => assertBirthMonthInRange("2026-11", NOW)).toThrow(AgeRangeError);
  });

  it("rolls over at UTC year end", () => {
    expect(monthsBetween("2026-12", new Date("2026-12-31T23:59:59Z"))).toBe(0);
    expect(monthsBetween("2026-12", new Date("2027-01-01T00:00:00Z"))).toBe(1);
  });

  it("keeps an outgrown child at 60-71m on read", () => {
    expect(deriveAgeBand("2015-01", NOW)).toBe("60-71m");
  });
});

describe("schemas", () => {
  it("normalizes nickname whitespace", () => {
    const r = CreateChildSchema.parse({ nickname: "  Sample   \t Child ", ageBand: "0-5m" });
    expect(r.nickname).toBe("Sample Child");
  });

  it("rejects control and invisible characters in nicknames", () => {
    for (const nickname of ["\u200b", "\u0007x", "a\u200bb", "\u200b a"]) {
      expect(CreateChildSchema.safeParse({ nickname, ageBand: "0-5m" }).success).toBe(false);
    }
  });

  it("accepts accented, emoji and Filipino nicknames", () => {
    for (const nickname of ["Niño", "Ma. Luisa", "José 🌟"]) {
      expect(CreateChildSchema.safeParse({ nickname, ageBand: "0-5m" }).success).toBe(true);
    }
  });

  it("reports object-level issues with a usable field", () => {
    const unknown = JSON.parse('{"nickname":"A","ageBand":"0-5m","__proto__":1,"caregiverId":"x"}');
    const r = CreateChildSchema.safeParse(unknown);
    expect(r.success).toBe(false);
    if (!r.success) {
      const d = toErrorDetails(r.error);
      expect(d).toContainEqual({ field: "caregiverId", issue: "Unknown field" });
      expect(d.every((x) => x.field !== "")).toBe(true);
    }
    for (const body of [null, []]) {
      const b = CreateChildSchema.safeParse(body);
      expect(b.success).toBe(false);
      if (!b.success) expect(toErrorDetails(b.error)[0].field).toBe("body");
    }
  });

  it("rejects empty, whitespace-only and over-long nicknames", () => {
    for (const nickname of ["", "   ", "x".repeat(51)]) {
      expect(CreateChildSchema.safeParse({ nickname, ageBand: "0-5m" }).success).toBe(false);
    }
    expect(CreateChildSchema.safeParse({ nickname: "x".repeat(50), ageBand: "0-5m" }).success).toBe(true);
  });

  it("treats 2025-13 as a shape error", () => {
    const r = CreateChildSchema.safeParse({ nickname: "A", birthMonthYear: "2025-13" });
    expect(r.success).toBe(false);
    if (!r.success) expect(toErrorDetails(r.error)[0].field).toBe("birthMonthYear");
  });

  it("create needs exactly one age source", () => {
    expect(CreateChildSchema.safeParse({ nickname: "A" }).success).toBe(false);
    expect(CreateChildSchema.safeParse({ nickname: "A", birthMonthYear: "2025-08", ageBand: "12-23m" }).success).toBe(false);
  });

  it("update rejects empty, both sources, nulls and unknown keys", () => {
    expect(UpdateChildSchema.safeParse({}).success).toBe(false);
    expect(UpdateChildSchema.safeParse({ birthMonthYear: "2025-08", ageBand: "12-23m" }).success).toBe(false);
    expect(UpdateChildSchema.safeParse({ nickname: null }).success).toBe(false);
    expect(UpdateChildSchema.safeParse({ ageBand: null }).success).toBe(false);
    expect(UpdateChildSchema.safeParse({ nickname: "A", caregiverId: "x" }).success).toBe(false);
    expect(CreateChildSchema.safeParse({ nickname: "A", ageBand: "0-5m", uid: "x" }).success).toBe(false);
    expect(UpdateChildSchema.safeParse({ nickname: "A" }).success).toBe(true);
  });
});

describe("mapping", () => {
  const input = CreateChildSchema.parse({ nickname: "Sample Child", birthMonthYear: "2025-08" });
  const stored = toStored(input, "uid-a", "id-1", NOW);

  it("maps names and derives the band", () => {
    expect(stored).toMatchObject({ name: "Sample Child", birthMonth: "2025-08", ageBand: "12-23m", caregiverId: "uid-a" });
    expect(toPublic(stored, NOW)).toMatchObject({ nickname: "Sample Child", birthMonthYear: "2025-08", ageBand: "12-23m" });
  });

  it("never exposes caregiverId", () => {
    expect(Object.keys(toPublic(stored, NOW))).not.toContain("caregiverId");
  });

  it("returns a chosen band as stored, without birthMonthYear", () => {
    const s = toStored(CreateChildSchema.parse({ nickname: "A", ageBand: "36-47m" }), "u", "i", NOW);
    const p = toPublic(s, new Date("2040-01-01T00:00:00Z"));
    expect(p.ageBand).toBe("36-47m");
    expect("birthMonthYear" in p).toBe(false);
  });

  it("re-derives the band on read", () => {
    expect(toPublic(stored, new Date("2027-10-15T00:00:00Z")).ageBand).toBe("24-35m");
  });

  it("update with ageBand removes the stored birth month", () => {
    const later = new Date("2026-10-16T00:00:00Z");
    const u = applyUpdate(stored, UpdateChildSchema.parse({ ageBand: "0-5m" }), later);
    expect(u.birthMonth).toBeUndefined();
    expect(u).toMatchObject({ ageBand: "0-5m", caregiverId: "uid-a", createdAt: stored.createdAt, updatedAt: later.toISOString() });
  });
});

describe("memory store list", () => {
  it("returns the first 50 children by createdAt, in order", async () => {
    const store = createMemoryChildrenStore();
    const mk = (n: number) => ({
      id: `id-${String(55 - n).padStart(2, "0")}`, // ids sort opposite to creation order
      caregiverId: "u1", name: `C${n}`, ageBand: "0-5m" as const,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(), updatedAt: "x"
    });
    for (let n = 54; n >= 0; n--) await store.create("u1", mk(n)); // insert newest first
    const list = await store.list("u1");
    expect(list).toHaveLength(LIST_LIMIT);
    expect(list.map((c) => c.name)).toEqual(Array.from({ length: 50 }, (_, n) => `C${n}`));
  });
});
