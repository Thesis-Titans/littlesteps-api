import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("uid-")) throw new Error("bad token");
      return { uid: token };
    }
  })
}));

import { app } from "../src/app.js";
import { setChildrenStore } from "../src/children/children-router.js";
import { createMemoryChildrenStore } from "../src/children/children-store.js";

const A = "Bearer uid-a";
const B = "Bearer uid-b";
const MISSING = "8c2bce8d-9066-428d-aafa-c26761845c6e";

function monthsAgo(n: number): string {
  const d = new Date();
  const t = d.getUTCFullYear() * 12 + d.getUTCMonth() - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

let store: ReturnType<typeof createMemoryChildrenStore>;
beforeEach(() => {
  store = createMemoryChildrenStore();
  setChildrenStore(store);
});

const create = (auth: string, body: object) => request(app).post("/api/v1/children").set("Authorization", auth).send(body);

describe("children routes", () => {
  it.each([[10], ["aborted"]])("returns 503 with Retry-After when create is aborted (code %s)", async (code) => {
    vi.spyOn(store, "create").mockRejectedValueOnce(Object.assign(new Error("contention"), { code }));
    const res = await create(A, { nickname: "Kid", ageBand: "0-5m" });
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ error: { code: "SERVICE_UNAVAILABLE", message: "Please try again in a moment." } });
  });

  it("still returns 500 for other create errors", async () => {
    vi.spyOn(store, "create").mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 13 }));
    const res = await create(A, { nickname: "Kid", ageBand: "0-5m" });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });

  it.each([[10], ["aborted"]])("returns 503 with Retry-After when update is aborted (code %s)", async (code) => {
    vi.spyOn(store, "update").mockRejectedValueOnce(Object.assign(new Error("contention"), { code }));
    const res = await request(app).patch(`/api/v1/children/${MISSING}`).set("Authorization", A).send({ nickname: "x" });
    expect(res.status).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ error: { code: "SERVICE_UNAVAILABLE", message: "Please try again in a moment." } });
  });

  it("still returns 500 for other update errors", async () => {
    vi.spyOn(store, "update").mockRejectedValueOnce(Object.assign(new Error("boom"), { code: 13 }));
    const res = await request(app).patch(`/api/v1/children/${MISSING}`).set("Authorization", A).send({ nickname: "x" });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns 401 without a valid token on every route", async () => {
    for (const r of [
      request(app).get("/api/v1/children"),
      request(app).post("/api/v1/children").send({}),
      request(app).get(`/api/v1/children/${MISSING}`),
      request(app).patch(`/api/v1/children/${MISSING}`).send({ nickname: "x" }),
      request(app).get("/api/v1/children").set("Authorization", "Bearer nope")
    ]) {
      const res = await r;
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });

  it("creates with a birth month", async () => {
    const res = await create(A, { nickname: "  Sample   Child ", birthMonthYear: monthsAgo(14) });
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toMatchObject({ nickname: "Sample Child", birthMonthYear: monthsAgo(14), ageBand: "12-23m" });
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(res.body).sort()).toEqual(["ageBand", "birthMonthYear", "createdAt", "id", "nickname", "updatedAt"]);
    expect(store.data.get(`uid-a/${res.body.id}`)?.caregiverId).toBe("uid-a");
  });

  it("creates with an age band only", async () => {
    const res = await create(A, { nickname: "Sample", ageBand: "6-11m" });
    expect(res.status).toBe(201);
    expect(res.body.ageBand).toBe("6-11m");
    expect(res.body).not.toHaveProperty("birthMonthYear");
  });

  it.each([
    ["both sources", { nickname: "S", ageBand: "6-11m", birthMonthYear: monthsAgo(3) }],
    ["neither source", { nickname: "S" }],
    ["childId in body", { nickname: "S", ageBand: "6-11m", childId: MISSING }],
    ["caregiverId in body", { nickname: "S", ageBand: "6-11m", caregiverId: "uid-b" }],
    ["bad month shape", { nickname: "S", birthMonthYear: "2025-13" }]
  ])("rejects create with %s (400)", async (_n, body) => {
    const res = await create(A, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(store.data.size).toBe(0);
  });

  it("rejects unparsable JSON with INVALID_JSON", async () => {
    const res = await request(app).post("/api/v1/children").set("Authorization", A).set("Content-Type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });

  it.each([["future", monthsAgo(-1)], ["too old", monthsAgo(72)]])("returns 422 for a %s birth month", async (_n, month) => {
    const res = await create(A, { nickname: "S", birthMonthYear: month });
    expect(res.status).toBe(422);
    expect(res.body.error).toEqual({
      code: "UNPROCESSABLE_ENTITY",
      message: "Child age must be between 0 and 71 months",
      details: [{ field: "birthMonthYear", issue: "Must not be in the future or older than 71 months" }]
    });
  });

  it("accepts the 0 and 71 month boundaries", async () => {
    expect((await create(A, { nickname: "S", birthMonthYear: monthsAgo(0) })).status).toBe(201);
    expect((await create(A, { nickname: "S", birthMonthYear: monthsAgo(71) })).status).toBe(201);
  });

  it("lists only the caller's children, oldest first", async () => {
    const first = await create(A, { nickname: "One", ageBand: "0-5m" });
    await create(B, { nickname: "Other", ageBand: "0-5m" });
    const second = await create(A, { nickname: "Two", ageBand: "0-5m" });
    const res = await request(app).get("/api/v1/children").set("Authorization", A);
    expect(res.status).toBe(200);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual([first.body.id, second.body.id].sort((x, y) => {
      const a = store.data.get(`uid-a/${x}`)!, b = store.data.get(`uid-a/${y}`)!;
      return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
    }));
    expect((await request(app).get("/api/v1/children").set("Authorization", "Bearer uid-c")).body).toEqual([]);
  });

  it("gets own child and never exposes internal fields", async () => {
    const { body } = await create(A, { nickname: "Sample", birthMonthYear: monthsAgo(2) });
    const res = await request(app).get(`/api/v1/children/${body.id}`).set("Authorization", A);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(JSON.stringify(res.body)).not.toMatch(/caregiverId|"name"|"birthMonth"/);
  });

  it("returns identical 404s for another caregiver's child, an unknown id and a malformed id", async () => {
    const { body } = await create(B, { nickname: "Theirs", ageBand: "0-5m" });
    const responses = [
      await request(app).get(`/api/v1/children/${body.id}`).set("Authorization", A),
      await request(app).get(`/api/v1/children/${MISSING}`).set("Authorization", A),
      await request(app).get("/api/v1/children/not-a-uuid").set("Authorization", A)
    ];
    for (const r of responses) {
      expect(r.status).toBe(404);
      expect(r.text).toBe(responses[0].text);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["content-length"]).toBe(responses[0].headers["content-length"]);
      expect(r.headers["content-type"]).toBe(responses[0].headers["content-type"]);
    }
    expect(responses[0].body).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });
  });

  it("treats a document whose stored caregiverId differs from the path as missing", async () => {
    const { body } = await create(A, { nickname: "S", ageBand: "0-5m" });
    store.data.get(`uid-a/${body.id}`)!.caregiverId = "uid-b";
    const res = await request(app).get(`/api/v1/children/${body.id}`).set("Authorization", A);
    expect(res.status).toBe(404);
  });

  it("patches the nickname with normalisation", async () => {
    const { body } = await create(A, { nickname: "Sample", birthMonthYear: monthsAgo(14) });
    const res = await request(app).patch(`/api/v1/children/${body.id}`).set("Authorization", A).send({ nickname: " New   Name " });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: body.id, nickname: "New Name", birthMonthYear: monthsAgo(14), ageBand: "12-23m", createdAt: body.createdAt });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("re-derives the band when the birth month is corrected", async () => {
    const { body } = await create(A, { nickname: "S", birthMonthYear: monthsAgo(14) });
    const res = await request(app).patch(`/api/v1/children/${body.id}`).set("Authorization", A).send({ birthMonthYear: monthsAgo(3) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ birthMonthYear: monthsAgo(3), ageBand: "0-5m" });
  });

  it("removes the birth month when an age band is chosen", async () => {
    const { body } = await create(A, { nickname: "S", birthMonthYear: monthsAgo(14) });
    const res = await request(app).patch(`/api/v1/children/${body.id}`).set("Authorization", A).send({ ageBand: "36-47m" });
    expect(res.status).toBe(200);
    expect(res.body.ageBand).toBe("36-47m");
    expect(res.body).not.toHaveProperty("birthMonthYear");
    expect(store.data.get(`uid-a/${body.id}`)).not.toHaveProperty("birthMonth");
  });

  it.each([
    ["both sources", { ageBand: "6-11m", birthMonthYear: monthsAgo(3) }],
    ["empty body", {}],
    ["null value", { nickname: null }],
    ["caregiverId", { caregiverId: "uid-b" }]
  ])("rejects patch with %s (400)", async (_n, payload) => {
    const { body } = await create(A, { nickname: "S", ageBand: "0-5m" });
    const res = await request(app).patch(`/api/v1/children/${body.id}`).set("Authorization", A).send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 422 when patching an out-of-range birth month", async () => {
    const { body } = await create(A, { nickname: "S", ageBand: "0-5m" });
    const res = await request(app).patch(`/api/v1/children/${body.id}`).set("Authorization", A).send({ birthMonthYear: monthsAgo(80) });
    expect(res.status).toBe(422);
  });

  it("returns 404 and leaves the child unchanged when patching another caregiver's child", async () => {
    const { body } = await create(B, { nickname: "Theirs", ageBand: "0-5m" });
    const before = JSON.stringify(store.data.get(`uid-b/${body.id}`));
    const res = await request(app).patch(`/api/v1/children/${body.id}`).set("Authorization", A).send({ nickname: "Hijack" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });
    expect(JSON.stringify(store.data.get(`uid-b/${body.id}`))).toBe(before);
    expect(store.data.has(`uid-a/${body.id}`)).toBe(false);
  });

  it("returns the same 404 when patching an unknown or malformed id", async () => {
    for (const id of [MISSING, "nope"]) {
      const res = await request(app).patch(`/api/v1/children/${id}`).set("Authorization", A).send({ nickname: "x" });
      expect(res.status).toBe(404);
    }
  });

  it("update on a missing child returns 404 and creates nothing", async () => {
    expect(await store.update("uid-a", MISSING, (c) => c)).toBeNull();
    const res = await request(app).patch(`/api/v1/children/${MISSING}`).set("Authorization", A).send({ nickname: "x" });
    expect(res.status).toBe(404);
    expect(store.data.size).toBe(0);
  });

  it("accepts 71 months and rejects 72 months and future months", async () => {
    expect((await create(A, { nickname: "Edge", birthMonthYear: monthsAgo(71) })).status).toBe(201);
    expect((await create(A, { nickname: "Edge", birthMonthYear: monthsAgo(72) })).status).toBe(422);
    expect((await create(A, { nickname: "Edge", birthMonthYear: monthsAgo(-1) })).status).toBe(422);
  });

  it("gives identical 400 and 422 bodies for own, foreign and unknown ids", async () => {
    const own = (await create(A, { nickname: "Mine", ageBand: "0-5m" })).body.id as string;
    for (const payload of [{ nickname: "" }, { birthMonthYear: monthsAgo(72) }]) {
      const res = await Promise.all([own, MISSING].map((id) => request(app).patch(`/api/v1/children/${id}`).set("Authorization", B).send(payload)));
      const ownerRes = await request(app).patch(`/api/v1/children/${own}`).set("Authorization", A).send(payload);
      expect([400, 422]).toContain(ownerRes.status);
      for (const r of res) {
        expect(r.status).toBe(ownerRes.status);
        expect(r.body).toEqual(ownerRes.body);
      }
    }
  });

  it("returns 422 on the 21st child, per caregiver, after body validation", async () => {
    for (let n = 0; n < 20; n++) expect((await create(A, { nickname: `C${n}`, ageBand: "0-5m" })).status).toBe(201);
    const res = await create(A, { nickname: "Extra", ageBand: "0-5m" });
    expect(res.status).toBe(422);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      error: {
        code: "UNPROCESSABLE_ENTITY",
        message: "You can add up to 20 children.",
        details: [{ field: "children", issue: "Limit of 20 children reached" }]
      }
    });
    expect((await create(A, { nickname: "" })).status).toBe(400);
    expect((await create(B, { nickname: "Other", ageBand: "0-5m" })).status).toBe(201);
    expect((await request(app).get("/api/v1/children").set("Authorization", A)).body).toHaveLength(20);
  });
});
