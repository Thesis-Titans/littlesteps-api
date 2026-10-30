import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("uid-")) throw new Error("bad token");
      return { uid: token };
    }
  })
}));

import { app } from "../../src/app.js";
import { setAiProvider } from "../../src/ai/ai-router.js";
import { createMemoryRateLimiter, setIpRateLimiter, setRateLimiter, type RateLimiter } from "../../src/ai/rate-limit.js";
import { FakeProvider } from "../../src/ai/providers/fake.js";
import { setApprovedActivitiesForTest, setCatalogActivities } from "../../src/catalog/catalog-service.js";
import { approved, baseRequest } from "./helpers.js";

const HOUR = 3600_000;
const START = 100 * HOUR + 600_000; // 10 minutes into an hour
let now = START;
let provider: FakeProvider;

const post = (uid: string, ip = "198.51.100.1", body: object = baseRequest) =>
  request(app).post("/api/v1/ai/recommendations").set("Authorization", `Bearer ${uid}`).set("X-Forwarded-For", ip).send(body);

beforeEach(() => {
  now = START;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  setApprovedActivitiesForTest([approved({ id: "a" })]);
  provider = FakeProvider.valid([{ id: "a" }]);
  setAiProvider(provider);
  setRateLimiter(createMemoryRateLimiter(10, () => now));
  setIpRateLimiter(createMemoryRateLimiter(30, () => now));
});
afterEach(() => {
  setAiProvider(null);
  setCatalogActivities([]);
  setRateLimiter(null);
  setIpRateLimiter(null);
  vi.restoreAllMocks();
});

describe("AI recommendations rate limit", () => {
  it("allows 10 requests an hour and rejects the 11th with the exact 429", async () => {
    for (let n = 0; n < 10; n++) expect((await post("uid-a")).status).toBe(200);
    now = START + 125_500; // 2 minutes 5.5 seconds later: 3600 - 600 - 125.5 = 2874.5 seconds left
    const res = await post("uid-a");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: { code: "RATE_LIMITED", message: "You have reached the hourly limit for suggestions. Please try again later." }
    });
    expect(res.headers["retry-after"]).toBe("2875");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(provider.calls).toBe(10);
  });

  it("keeps Retry-After between 1 and 3600", async () => {
    setRateLimiter(createMemoryRateLimiter(0, () => now));
    now = 101 * HOUR - 200; // 200 ms before the hour ends
    expect((await post("uid-a")).headers["retry-after"]).toBe("1");
    now = 101 * HOUR; // start of a window
    expect((await post("uid-a")).headers["retry-after"]).toBe("3600");
  });

  it("does not affect a different user", async () => {
    for (let n = 0; n < 11; n++) await post("uid-a");
    expect((await post("uid-b")).status).toBe(200);
  });

  it("counts requests that fail validation", async () => {
    for (let n = 0; n < 10; n++) expect((await post("uid-a", "198.51.100.1", { nope: 1 })).status).toBe(400);
    expect((await post("uid-a")).status).toBe(429);
  });

  it("does not count unauthenticated requests", async () => {
    for (let n = 0; n < 40; n++) expect((await request(app).post("/api/v1/ai/recommendations").send(baseRequest)).status).toBe(401);
    expect((await post("uid-a")).status).toBe(200);
  });

  it("applies the per-IP cap of 30 across users", async () => {
    for (let n = 0; n < 30; n++) expect((await post(`uid-${n}`, "203.0.113.9")).status).toBe(200);
    const res = await post("uid-new", "203.0.113.9");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect((await post("uid-new", "203.0.113.10")).status).toBe(200);
  });

  it("uses the rightmost X-Forwarded-For entry, so a forged leading entry does not help", async () => {
    for (let n = 0; n < 30; n++) await post(`uid-${n}`, `10.0.0.${n}, 203.0.113.9`);
    expect((await post("uid-x", "10.9.9.9, 203.0.113.9")).status).toBe(429);
  });

  it("starts a new window in the next hour", async () => {
    for (let n = 0; n < 11; n++) await post("uid-a");
    now = 101 * HOUR;
    expect((await post("uid-a")).status).toBe(200);
  });

  it("fails open and logs only an event name when the limiter errors", async () => {
    const broken: RateLimiter = { hit: async () => { throw new Error("secret-uid-a store down"); } };
    setRateLimiter(broken);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await post("uid-a")).status).toBe(200);
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: "ai.rate_limit_unavailable" }));
  });
});
