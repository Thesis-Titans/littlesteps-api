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
import { setMilestonesStore } from "../src/milestones/milestones-router.js";
import { isFutureDate } from "../src/milestones/schemas.js";
import { createMemoryMilestonesStore } from "../src/milestones/milestones-store.js";
import type { StoredChild } from "../src/children/types.js";

const AUTH_A = "Bearer uid-a";
const AUTH_B = "Bearer uid-b";
const MISSING_UUID = "8c2bce8d-9066-428d-aafa-c26761845c6e";

let childrenStore: ReturnType<typeof createMemoryChildrenStore>;
let milestonesStore: ReturnType<typeof createMemoryMilestonesStore>;
let childA: StoredChild;
let childB: StoredChild;

function futureDate(daysAhead = 2): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function pastDate(daysAgo = 2): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

beforeEach(async () => {
  childrenStore = createMemoryChildrenStore();
  setChildrenStore(childrenStore);
  milestonesStore = createMemoryMilestonesStore();
  setMilestonesStore(milestonesStore);

  const now = new Date().toISOString();
  childA = {
    id: "11111111-1111-4111-8111-111111111111",
    caregiverId: "uid-a",
    name: "Child A",
    ageBand: "12-23m",
    createdAt: now,
    updatedAt: now
  };
  childB = {
    id: "22222222-2222-4222-8222-222222222222",
    caregiverId: "uid-b",
    name: "Child B",
    ageBand: "24-35m",
    createdAt: now,
    updatedAt: now
  };

  await childrenStore.create("uid-a", childA);
  await childrenStore.create("uid-b", childB);
});

describe("milestone observation records API", () => {
  describe("authentication", () => {
    it("returns 401 without a valid bearer token on every route", async () => {
      const endpoints = [
        request(app).get(`/api/v1/children/${childA.id}/milestones`),
        request(app).post(`/api/v1/children/${childA.id}/milestones`).send({ milestoneId: "ms-1", status: "observed" }),
        request(app).patch(`/api/v1/children/${childA.id}/milestones/ms-1`).send({ status: "not_sure" }),
        request(app).get(`/api/v1/children/${childA.id}/milestones`).set("Authorization", "Bearer invalid")
      ];

      for (const req of endpoints) {
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
      }
    });
  });

  describe("non-diagnostic milestone statuses & CRUD", () => {
    it.each([
      ["observed", "observed"],
      ["not yet observed", "not_yet_observed"],
      ["not sure (F3 walkthrough finding)", "not_sure"]
    ])("records milestone with valid non-diagnostic status: %s", async (_label, status) => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({
          milestoneId: `ms-mot-12-23m-${status}`,
          status,
          notes: "Recorded during morning play"
        });

      expect(res.status).toBe(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.status).toBe(status);
      expect(res.body.milestoneId).toBe(`ms-mot-12-23m-${status}`);
      expect(res.body.observedDate).toBe(new Date().toISOString().slice(0, 10));
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(res.body)).not.toContain("caregiverId");
    });

    it.each([
      ["delayed", "delayed"],
      ["behind", "behind"],
      ["normal", "normal"],
      ["risk", "risk"],
      ["score", "score"]
    ])("strictly rejects clinical or diagnostic status '%s' with 400", async (_label, status) => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({
          milestoneId: "ms-mot-01",
          status
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("lists milestone observations and supports filtering", async () => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-1", status: "observed", observedDate: pastDate(3) });

      await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-2", status: "not_sure", observedDate: pastDate(1) });

      // List all
      const listAll = await request(app)
        .get(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A);

      expect(listAll.status).toBe(200);
      expect(Array.isArray(listAll.body)).toBe(true);
      expect(listAll.body).toHaveLength(2);

      // Filter by status
      const filterStatus = await request(app)
        .get(`/api/v1/children/${childA.id}/milestones?status=not_sure`)
        .set("Authorization", AUTH_A);

      expect(filterStatus.status).toBe(200);
      expect(filterStatus.body).toHaveLength(1);
      expect(filterStatus.body[0].milestoneId).toBe("ms-2");

      // Filter by milestoneId
      const filterMilestone = await request(app)
        .get(`/api/v1/children/${childA.id}/milestones?milestoneId=ms-1`)
        .set("Authorization", AUTH_A);

      expect(filterMilestone.status).toBe(200);
      expect(filterMilestone.body).toHaveLength(1);
      expect(filterMilestone.body[0].status).toBe("observed");
    });

    it("patches observation using canonical milestoneId slug", async () => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-cog-01", status: "not_yet_observed" });

      const patchRes = await request(app)
        .patch(`/api/v1/children/${childA.id}/milestones/ms-cog-01`)
        .set("Authorization", AUTH_A)
        .send({
          status: "observed",
          notes: "Observed stacking rings today"
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe("observed");
      expect(patchRes.body.notes).toBe("Observed stacking rings today");
    });

    it("patches observation using observation UUID id", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-lan-01", status: "not_sure" });

      const patchRes = await request(app)
        .patch(`/api/v1/children/${childA.id}/milestones/${created.body.id}`)
        .set("Authorization", AUTH_A)
        .send({
          status: "observed"
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.status).toBe("observed");
    });
  });

  describe("caregiver ownership isolation (BOLA defense)", () => {
    it("returns identical 404 when caregiver A attempts to access caregiver B's child milestones", async () => {
      // Caregiver B creates an observation
      const bObs = await request(app)
        .post(`/api/v1/children/${childB.id}/milestones`)
        .set("Authorization", AUTH_B)
        .send({ milestoneId: "ms-b", status: "observed" });

      expect(bObs.status).toBe(201);
      const obsId = bObs.body.id;

      // Caregiver A attempts list
      const listRes = await request(app)
        .get(`/api/v1/children/${childB.id}/milestones`)
        .set("Authorization", AUTH_A);
      expect(listRes.status).toBe(404);
      expect(listRes.body.error.code).toBe("RESOURCE_NOT_FOUND");

      // Caregiver A attempts create
      const createRes = await request(app)
        .post(`/api/v1/children/${childB.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-hijack", status: "observed" });
      expect(createRes.status).toBe(404);
      expect(createRes.body.error.code).toBe("RESOURCE_NOT_FOUND");

      // Caregiver A attempts patch by obsId
      const patchById = await request(app)
        .patch(`/api/v1/children/${childB.id}/milestones/${obsId}`)
        .set("Authorization", AUTH_A)
        .send({ status: "not_sure" });
      expect(patchById.status).toBe(404);
      expect(patchById.body.error.code).toBe("RESOURCE_NOT_FOUND");

      // Caregiver A attempts patch by milestoneId
      const patchByMilestone = await request(app)
        .patch(`/api/v1/children/${childB.id}/milestones/ms-b`)
        .set("Authorization", AUTH_A)
        .send({ status: "not_sure" });
      expect(patchByMilestone.status).toBe(404);
      expect(patchByMilestone.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("returns identical 404 for unknown childId and malformed childId", async () => {
      const resMissing = await request(app)
        .get(`/api/v1/children/${MISSING_UUID}/milestones`)
        .set("Authorization", AUTH_A);
      const resMalformed = await request(app)
        .get("/api/v1/children/not-a-uuid/milestones")
        .set("Authorization", AUTH_A);

      expect(resMissing.status).toBe(404);
      expect(resMalformed.status).toBe(404);
      expect(resMissing.body).toEqual(resMalformed.body);
    });
  });

  describe("validation and 422 business logic errors", () => {
    it("returns 422 UNPROCESSABLE_ENTITY when observedDate is in the future", async () => {
      const future = futureDate(3);
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({
          milestoneId: "ms-future",
          status: "observed",
          observedDate: future
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toEqual({
        code: "UNPROCESSABLE_ENTITY",
        message: "Observation date cannot be in the future",
        details: [{ field: "observedDate", issue: "Must not be in the future" }]
      });
    });

    it("returns 422 when patching with a future observedDate", async () => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-valid", status: "observed" });

      const res = await request(app)
        .patch(`/api/v1/children/${childA.id}/milestones/ms-valid`)
        .set("Authorization", AUTH_A)
        .send({ observedDate: futureDate(5) });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it.each([
      ["missing milestoneId", { status: "observed" }],
      ["missing status", { milestoneId: "ms-1" }],
      ["malformed date shape", { milestoneId: "ms-1", status: "observed", observedDate: "2026-14-99" }],
      ["invalid calendar date", { milestoneId: "ms-1", status: "observed", observedDate: "2026-02-30" }],
      ["disallowed extra field", { milestoneId: "ms-1", status: "observed", caregiverId: "uid-a" }]
    ])("rejects create with %s (400)", async (_n, body) => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it.each([
      ["empty body", {}],
      ["null status", { status: null }],
      ["unrecognized field", { extra: "field" }]
    ])("rejects patch with %s (400)", async (_n, body) => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-1", status: "observed" });

      const res = await request(app)
        .patch(`/api/v1/children/${childA.id}/milestones/ms-1`)
        .set("Authorization", AUTH_A)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });

    it("accepts observedDate one day ahead of UTC today (today in UTC+14) and rejects two days ahead on create and patch", async () => {
      const tomorrowUtc = futureDate(1);
      const twoDaysAheadUtc = futureDate(2);

      const createTomorrow = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({
          milestoneId: "ms-utc14-today",
          status: "observed",
          observedDate: tomorrowUtc
        });
      expect(createTomorrow.status).toBe(201);
      expect(createTomorrow.body.observedDate).toBe(tomorrowUtc);

      const createTwoDaysAhead = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({
          milestoneId: "ms-two-days-ahead",
          status: "observed",
          observedDate: twoDaysAheadUtc
        });
      expect(createTwoDaysAhead.status).toBe(422);
      expect(createTwoDaysAhead.body.error.code).toBe("UNPROCESSABLE_ENTITY");

      const patchTomorrow = await request(app)
        .patch(`/api/v1/children/${childA.id}/milestones/ms-utc14-today`)
        .set("Authorization", AUTH_A)
        .send({ observedDate: tomorrowUtc });
      expect(patchTomorrow.status).toBe(200);
      expect(patchTomorrow.body.observedDate).toBe(tomorrowUtc);

      const patchTwoDaysAhead = await request(app)
        .patch(`/api/v1/children/${childA.id}/milestones/ms-utc14-today`)
        .set("Authorization", AUTH_A)
        .send({ observedDate: twoDaysAheadUtc });
      expect(patchTwoDaysAhead.status).toBe(422);
      expect(patchTwoDaysAhead.body.error.code).toBe("UNPROCESSABLE_ENTITY");
    });

    it("checks isFutureDate boundary across UTC+14 and month rollovers", () => {
      const now = new Date("2026-10-31T10:00:00Z");
      expect(isFutureDate("2026-10-31", now)).toBe(false);
      expect(isFutureDate("2026-11-01", now)).toBe(false);
      expect(isFutureDate("2026-11-02", now)).toBe(true);
    });

  describe("error handling and resilience", () => {
    it("returns 503 with Retry-After when create is aborted by contention", async () => {
      vi.spyOn(milestonesStore, "create").mockRejectedValueOnce(Object.assign(new Error("contention"), { code: 10 }));

      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-1", status: "observed" });

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("1");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("returns 503 with Retry-After when update is aborted by contention", async () => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/milestones`)
        .set("Authorization", AUTH_A)
        .send({ milestoneId: "ms-1", status: "observed" });

      vi.spyOn(milestonesStore, "update").mockRejectedValueOnce(Object.assign(new Error("contention"), { code: "aborted" }));

      const res = await request(app)
        .patch(`/api/v1/children/${childA.id}/milestones/ms-1`)
        .set("Authorization", AUTH_A)
        .send({ status: "not_sure" });

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("1");
      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });
  });
});
