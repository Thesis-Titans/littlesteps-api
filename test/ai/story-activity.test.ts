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
import { setIpRateLimiter, setRateLimiter } from "../../src/ai/rate-limit.js";
import { FakeProvider } from "../../src/ai/providers/fake.js";
import { CircuitBreakerProvider } from "../../src/ai/providers/circuit-breaker.js";
import { suggestStoryActivity } from "../../src/ai/ai-service.js";
import { setApprovedActivitiesForTest, setCatalogActivities } from "../../src/catalog/catalog-service.js";
import { approved } from "./helpers.js";

const postStory = (body: unknown, token: string | null = "good") => {
  const req = request(app).post("/api/v1/ai/story-activity");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body as object);
};

const validRequest = {
  bookTitle: "The Very Hungry Caterpillar",
  subjects: ["Counting", "Animals"],
  ageBand: "12-23m"
};

beforeEach(() => {
  setRateLimiter(null);
  setIpRateLimiter(null);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  setApprovedActivitiesForTest([
    approved({ id: "count-fruit", title: "Count the Fruit", domain: "cognitive", tags: ["counting"] }),
    approved({ id: "animal-walk", title: "Animal Walk", domain: "motor", tags: ["animals"] })
  ]);
});

afterEach(() => {
  setAiProvider(null);
  setCatalogActivities([]);
  vi.restoreAllMocks();
});

describe("POST /api/v1/ai/story-activity", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await postStory(validRequest, null);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid bearer token", async () => {
    const res = await postStory(validRequest, "bad");
    expect(res.status).toBe(401);
  });

  it.each(["childId", "nickname", "notes", "journalText"])(
    "strictly rejects unknown or identifying field %s with 400",
    async (field) => {
      const res = await postStory({ ...validRequest, [field]: "secret-or-id" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    }
  );

  it("rejects request missing both bookTitle and title with 400", async () => {
    const res = await postStory({ subjects: ["Animals"], ageBand: "12-23m" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("rejects invalid ageBand with 400", async () => {
    const res = await postStory({ ...validRequest, ageBand: "72-84m" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns Tier 3 deterministic catalog fallback when no provider is configured", async () => {
    const res = await postStory(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.bookTitle).toBe("The Very Hungry Caterpillar");
    expect(res.body.provenance.tier).toBe(3);
    expect(res.body.provenance.source).toBe("catalog");
    expect(res.body.provenance.badge).toBeNull();
    expect(res.body.suggestion.title).toBeTruthy();
    expect(res.body.suggestion.instructions).toBeTruthy();
    expect(res.body.suggestion.safetyNotice).toBeTruthy();
  });

  it("accepts title alias as bookTitle", async () => {
    const res = await postStory({ title: "Goodnight Moon", ageBand: "12-23m" });
    expect(res.status).toBe(200);
    expect(res.body.bookTitle).toBe("Goodnight Moon");
  });

  it("returns Tier 1 provider suggestion when provider returns valid output", async () => {
    const fake = new FakeProvider(() => ({
      title: "Caterpillar Fruit Snack Count",
      domain: "cognitive",
      instructions: "Line up apple slices and count aloud together as you read.",
      safetyNotice: "Ensure adult supervision while snacking."
    }));
    setAiProvider(fake);

    const res = await postStory(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.provenance.tier).toBe(1);
    expect(res.body.provenance.badge).toBe("Suggested by AI");
    expect(res.body.provenance.source).toBe(fake.model);
    expect(res.body.suggestion.title).toBe("Caterpillar Fruit Snack Count");
    expect(res.body.suggestion.domain).toBe("cognitive");
  });

  it("falls back to Tier 3 when provider outputs words on the non-diagnostic denylist", async () => {
    const fake = new FakeProvider(() => ({
      title: "Assessment Play for Developmental Delays",
      domain: "cognitive",
      instructions: "Test whether your child is behind in fine motor skills.",
      safetyNotice: "Observe carefully."
    }));
    setAiProvider(fake);

    const res = await postStory(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.provenance.tier).toBe(3);
    expect(res.body.provenance.source).toBe("catalog");
    expect(res.body.provenance.badge).toBeNull();
  });

  it("falls back to Tier 3 when provider outputs malformed JSON or invalid schema", async () => {
    const fake = new FakeProvider(() => "not a valid json object");
    setAiProvider(fake);

    const res = await postStory(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.provenance.tier).toBe(3);
    expect(res.body.provenance.source).toBe("catalog");
  });

  it("falls back to Tier 3 when provider throws an unexpected error", async () => {
    const fake = new FakeProvider(() => {
      throw new Error("provider connection failed");
    });
    setAiProvider(fake);

    const res = await postStory(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.provenance.tier).toBe(3);
    expect(res.body.provenance.source).toBe("catalog");
  });

  it("falls back to Tier 3 when circuit breaker is open", async () => {
    const failingProvider = {
      model: "failing-model",
      suggest: async () => {
        throw new Error("api down");
      }
    };
    const now = 1000;
    const breaker = new CircuitBreakerProvider(failingProvider, () => now);
    const controller = new AbortController();
    // Trip the circuit breaker by throwing 3 consecutive errors
    for (let i = 0; i < 3; i++) {
      await expect(breaker.suggest("prompt", controller.signal)).rejects.toThrow("api down");
    }

    setAiProvider(breaker);

    const res = await postStory(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.provenance.tier).toBe(3);
    expect(res.body.provenance.source).toBe("catalog");
    expect(res.body.provenance.badge).toBeNull();
  });

  it("falls back to Tier 3 on timeout in suggestStoryActivity", async () => {
    const slowProvider = new FakeProvider(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          }, 50);
        })
    );

    const res = await suggestStoryActivity(validRequest, slowProvider, 20);
    expect(res.provenance.tier).toBe(3);
    expect(res.provenance.source).toBe("catalog");
    expect(res.provenance.badge).toBeNull();
    expect(res.suggestion.title).toBeTruthy();
  });
});
