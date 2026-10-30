import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (token !== "good") throw new Error("bad token");
      return { uid: "caregiver-1" };
    }
  })
}));

import { app } from "../../src/app.js";
import { setAiProvider } from "../../src/ai/ai-router.js";
import { recommend } from "../../src/ai/ai-service.js";
import { FakeProvider } from "../../src/ai/providers/fake.js";
import { setApprovedActivitiesForTest, setCatalogActivities } from "../../src/catalog/catalog-service.js";
import { SYNTHETIC_ACTIVITIES } from "../fixtures/catalog-activities.synthetic.js";
import { approved, baseRequest } from "./helpers.js";

const post = (body: unknown, token: string | null = "good") => {
  const req = request(app).post("/api/v1/ai/recommendations");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body as object);
};

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  setApprovedActivitiesForTest([approved({ id: "a" }), approved({ id: "b", durationMinutes: 5 })]);
});
afterEach(() => {
  setAiProvider(null);
  setCatalogActivities([]);
  vi.restoreAllMocks();
});

describe("POST /api/v1/ai/recommendations", () => {
  it("returns 401 without a token", async () => {
    const res = await post(baseRequest, null);
    expect(res.status).toBe(401);
  });

  it("returns 401 for a bad token", async () => {
    expect((await post(baseRequest, "bad")).status).toBe(401);
  });

  it.each(["childId", "nickname", "notes"])("rejects unknown key %s with a detail", async (key) => {
    const res = await post({ ...baseRequest, [key]: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
    expect(res.body.error.details).toEqual([{ field: key, issue: "Unknown field" }]);
  });

  it("gives one detail per unknown key", async () => {
    const res = await post({ ...baseRequest, childId: "x", notes: "y" });
    expect(res.body.error.details).toHaveLength(2);
  });

  it("rejects out-of-range values with field details", async () => {
    const res = await post({ ...baseRequest, timeMinutes: 4, count: 4, materials: Array(11).fill("a") });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { field: string }) => d.field).sort()).toEqual(["count", "materials", "timeMinutes"]);
  });

  it("returns NO_REVIEWED_CONTENT without calling the provider when nothing is approved", async () => {
    setCatalogActivities([]);
    const provider = FakeProvider.valid([{ id: "a" }]);
    setAiProvider(provider);
    const res = await post(baseRequest);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ suggestions: [], source: "catalog_fallback", tier: 3, reason: "NO_REVIEWED_CONTENT" });
    expect(provider.calls).toBe(0);
  });

  it("never recommends synthetic fixtures", async () => {
    setCatalogActivities(SYNTHETIC_ACTIVITIES);
    const provider = FakeProvider.valid([{ id: SYNTHETIC_ACTIVITIES[0].id }]);
    setAiProvider(provider);
    for (const band of ["0-5m", "6-11m", "12-23m"]) {
      const res = await post({ ...baseRequest, ageBand: band, language: "fil" });
      expect(res.body.suggestions).toEqual([]);
      expect(res.body.reason).toBe("NO_REVIEWED_CONTENT");
    }
    expect(provider.calls).toBe(0);
  });

  it("uses the deterministic ranker with no provider", async () => {
    const res = await post(baseRequest);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.source).toBe("catalog_fallback");
    expect(res.body.tier).toBe(3);
    expect(res.body.suggestions.map((s: { activityId: string }) => s.activityId)).toEqual(["b", "a"]);
    expect(res.body.provenance).toMatchObject({ badge: null, label: "Our picks", model: null, reviewed: true });
  });

  it("returns source ai with the badge for valid provider output, titles from the catalog", async () => {
    const provider = FakeProvider.valid([{ id: "a", why: "Uses the blocks you have." }]);
    setAiProvider(provider);
    const res = await post(baseRequest);
    expect(res.body.source).toBe("ai");
    expect(res.body.tier).toBe(1);
    expect(res.body.provenance).toMatchObject({
      badge: "Suggested by AI",
      label: null,
      model: "fake-model",
      disclaimer: "Observational play suggestion only. Not developmental assessment.",
      guidance: "You know your child best. Change it as you like, and stay close while you play."
    });
    expect(res.body.suggestions[0]).toMatchObject({ activityId: "a", title: "Title a", whyPicked: "Uses the blocks you have." });
    expect(res.body.suggestions[0].activity.id).toBe("a");
    expect(provider.calls).toBe(1);
  });

  it.each([
    ["invented id", () => FakeProvider.inventedId()],
    ["duplicate", () => FakeProvider.duplicate("a")],
    ["over-length", () => FakeProvider.overLength("a")],
    ["denylist", () => FakeProvider.denylistHit("a")],
    ["malformed", () => FakeProvider.malformed()],
    ["throws", () => FakeProvider.throws()]
  ])("falls back to tier 3 on %s", async (_name, make) => {
    setAiProvider(make());
    const res = await post(baseRequest);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ source: "catalog_fallback", tier: 3 });
    expect(res.body.provenance.badge).toBeNull();
    expect(res.body.suggestions.length).toBeGreaterThan(0);
  });

  it("does not log prompts, replies or request data", async () => {
    setAiProvider(FakeProvider.valid([{ id: "a" }]));
    await post({ ...baseRequest, materials: ["secret-material"] });
    const logged = JSON.stringify((console.info as ReturnType<typeof vi.fn>).mock.calls);
    expect(logged).not.toContain("secret-material");
    expect(logged).not.toContain("caregiver-1");
  });
});

describe("recommend timeout", () => {
  it("falls back when the provider hangs past the timeout and aborts it", async () => {
    const provider = FakeProvider.hangs();
    const parsed = { ...baseRequest, setting: "either", materials: [], count: 3 } as const;
    const res = await recommend(parsed, provider, 20);
    expect(res.source).toBe("catalog_fallback");
    expect(res.tier).toBe(3);
    expect(provider.calls).toBe(1);
  });

  it("does not leak sensitive terms into the prompt sent to the provider", async () => {
    const provider = FakeProvider.valid([{ id: "a" }]);
    await recommend({ ...baseRequest, setting: "either", materials: ["Blocks"], count: 3 }, provider);
    for (const word of ["nickname", "birth", "notes", "uid", "caregiver-1", "ip "]) {
      expect(provider.prompts[0].toLowerCase()).not.toContain(word);
    }
  });
});
