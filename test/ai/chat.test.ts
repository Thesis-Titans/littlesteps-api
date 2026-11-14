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
import { setApprovedActivitiesForTest, setCatalogActivities } from "../../src/catalog/catalog-service.js";
import { approved } from "./helpers.js";

const postChat = (body: unknown, token: string | null = "good") => {
  const req = request(app).post("/api/v1/ai/chat");
  if (token) req.set("Authorization", `Bearer ${token}`);
  return req.send(body as object);
};

const validChat = {
  message: "What can I play with Maya using an empty box?",
  ageBand: "12-23m",
  childNickname: "Maya"
};

beforeEach(() => {
  setRateLimiter(null);
  setIpRateLimiter(null);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  setApprovedActivitiesForTest([
    approved({ id: "box-tunnel", title: "Box Peek Tunnel", domain: "cognitive", tags: ["box"] })
  ]);
});

afterEach(() => {
  setAiProvider(null);
  setCatalogActivities([]);
  vi.restoreAllMocks();
});

describe("POST /api/v1/ai/chat", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await postChat(validChat, null);
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid bearer token", async () => {
    const res = await postChat(validChat, "bad");
    expect(res.status).toBe(401);
  });

  it("returns 400 INVALID_INPUT on missing message or ageBand", async () => {
    const res = await postChat({ message: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("triggers strict pediatric non-diagnostic guardrail on clinical questions", async () => {
    const res = await postChat({
      message: "Maya has a high fever and won't stop coughing, what medicine should I give?",
      ageBand: "12-23m"
    });
    expect(res.status).toBe(200);
    expect(res.body.suggestedActivity).toBeNull();
    expect(res.body.reply).toMatch(/pediatrician|barangay health worker/i);
    expect(res.body.provenance.source).toBe("pediatric-guardrail");
  });

  it("triggers pediatric guardrail on developmental delay / autism questions", async () => {
    const res = await postChat({
      message: "Is Maya delayed in speech? Could this be autism?",
      ageBand: "12-23m"
    });
    expect(res.status).toBe(200);
    expect(res.body.suggestedActivity).toBeNull();
    expect(res.body.reply).toMatch(/pediatrician|barangay health worker/i);
  });

  it("falls back to reviewed catalog play activity when provider is unconfigured", async () => {
    const res = await postChat(validChat);
    expect(res.status).toBe(200);
    expect(res.body.reply).toBeDefined();
    expect(res.body.suggestedActivity).toBeDefined();
    expect(res.body.suggestedActivity.title).toBeDefined();
    expect(res.body.provenance.tier).toBe(3);
    expect(res.body.provenance.source).toBe("catalog");
  });
});
