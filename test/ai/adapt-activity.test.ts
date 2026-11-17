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
import { setApprovedActivitiesForTest, setCatalogActivities } from "../../src/catalog/catalog-service.js";
import { approved } from "./helpers.js";

const postAdapt = (body: unknown, token: string | null = "good") => {
  const req = request(app).post("/api/v1/ai/adapt");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body as object);
};

const validRequest = {
  activityId: "stack-cups",
  adjustment: "missing_material",
  missingMaterial: "plastic cups"
};

beforeEach(() => {
  setRateLimiter(null);
  setIpRateLimiter(null);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  setApprovedActivitiesForTest([
    approved({
      id: "stack-cups",
      title: "Stack the Cups",
      domain: "cognitive",
      materials: ["plastic cups", "wooden spoons"],
      instructions: ["Set cups on the floor.", "Show stacking them high.", "Let toddler knock them down."]
    }),
    approved({
      id: "sensory-crawl",
      title: "Cushion Mountain Crawl",
      domain: "motor",
      materials: ["cushions", "pillows"],
      instructions: ["Place cushions on the carpet.", "Encourage crawling over the cushions."]
    })
  ]);
});

afterEach(() => {
  setAiProvider(null);
  setCatalogActivities([]);
  vi.restoreAllMocks();
});

describe("POST /api/v1/ai/adapt", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await postAdapt(validRequest, null);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid bearer token", async () => {
    const res = await postAdapt(validRequest, "bad");
    expect(res.status).toBe(401);
  });

  it.each(["childId", "nickname", "notes", "secret"])(
    "strictly rejects identifying field %s with 400",
    async (field) => {
      const res = await postAdapt({ ...validRequest, [field]: "secret-value" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    }
  );

  it("returns 400 for invalid adjustment enum", async () => {
    const res = await postAdapt({ activityId: "stack-cups", adjustment: "faster" });
    expect(res.status).toBe(400);
  });

  it("returns 404 when activityId does not exist in catalog", async () => {
    const res = await postAdapt({ activityId: "nonexistent-act", adjustment: "shorter" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("returns Tier 2 fallback adaptation when provider is null (missing_material)", async () => {
    const res = await postAdapt(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.tier).toBe(2);
    expect(res.body.provenance.badge).toBeNull();
    expect(res.body.adapted).toEqual(
      expect.objectContaining({
        activityId: "stack-cups",
        originalTitle: "Stack the Cups",
        adaptedTitle: "Home Play: Stack the Cups",
        adjustment: "missing_material",
        explanation: expect.stringContaining("plastic cups")
      })
    );
    expect(res.body.adapted.materials).toContain("Safe everyday household alternative");
  });

  it.each(["shorter", "easier", "harder"] as const)(
    "returns Tier 2 fallback for adjustment: %s",
    async (adjustment) => {
      const res = await postAdapt({ activityId: "stack-cups", adjustment });
      expect(res.status).toBe(200);
      expect(res.body.tier).toBe(2);
      expect(res.body.adapted.adjustment).toBe(adjustment);
    }
  );

  it("returns Tier 1 AI adaptation when provider returns valid schema", async () => {
    const fakeAiReply = {
      adaptedTitle: "Tupperware Tower Stacking",
      instructions: [
        "Gather plastic storage containers or bowls of different sizes.",
        "Demonstrate nesting and stacking them gently upside down.",
        "Cheer as your toddler explores balancing each container."
      ],
      materials: ["Plastic storage containers", "Clean sponges"],
      safetyNotice: "Ensure containers have no sharp edges or loose lids.",
      explanation: "Uses lightweight plastic food containers as a safe substitute for cups."
    };

    setAiProvider(new FakeProvider(() => fakeAiReply));

    const res = await postAdapt(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("ai");
    expect(res.body.tier).toBe(1);
    expect(res.body.provenance.badge).toBe("Suggested by AI");
    expect(res.body.adapted.adaptedTitle).toBe("Tupperware Tower Stacking");
    expect(res.body.adapted.instructions).toHaveLength(3);
  });

  it("falls back to Tier 2 when AI output hits non-diagnostic denylist", async () => {
    const denylistAiReply = {
      adaptedTitle: "Treating Developmental Delay Stacking",
      instructions: ["Step 1 for therapy."],
      materials: ["Boxes"],
      safetyNotice: "Safety first.",
      explanation: "Testing delay diagnosis."
    };

    setAiProvider(new FakeProvider(() => denylistAiReply));

    const res = await postAdapt(validRequest);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.tier).toBe(2);
    expect(res.body.provenance.badge).toBeNull();
  });
});
