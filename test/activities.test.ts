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
import { setPlansStore } from "../src/activities/activities-router.js";
import { createMemoryPlansStore } from "../src/activities/activities-store.js";
import type { StoredChild } from "../src/children/types.js";

const AUTH_A = "Bearer uid-a";
const AUTH_B = "Bearer uid-b";
const MISSING_UUID = "8c2bce8d-9066-428d-aafa-c26761845c6e";

let childrenStore: ReturnType<typeof createMemoryChildrenStore>;
let plansStore: ReturnType<typeof createMemoryPlansStore>;
let childA: StoredChild;
let childB: StoredChild;

beforeEach(async () => {
  childrenStore = createMemoryChildrenStore();
  setChildrenStore(childrenStore);
  plansStore = createMemoryPlansStore();
  setPlansStore(plansStore);

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

describe("activities planning and completion API", () => {
  describe("authentication", () => {
    it("returns 401 without a valid bearer token on every route", async () => {
      const endpoints = [
        request(app).get(`/api/v1/children/${childA.id}/plans`),
        request(app).post(`/api/v1/children/${childA.id}/plans`).send({ activityId: "act-1", scheduledDate: "2026-11-01" }),
        request(app).patch(`/api/v1/children/${childA.id}/plans/${MISSING_UUID}`).send({ status: "completed" }),
        request(app).delete(`/api/v1/children/${childA.id}/plans/${MISSING_UUID}`),
        request(app).get(`/api/v1/children/${childA.id}/plans`).set("Authorization", "Bearer invalid")
      ];

      for (const req of endpoints) {
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
      }
    });
  });

  describe("CRUD operations", () => {
    it("creates a planned activity with default planned status", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({
          activityId: "act-ph-bahay-bahayan-01",
          scheduledDate: "2026-11-05"
        });

      expect(res.status).toBe(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toMatchObject({
        childId: childA.id,
        activityId: "act-ph-bahay-bahayan-01",
        scheduledDate: "2026-11-05",
        status: "planned"
      });
      expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.body.createdAt).toBeDefined();
      expect(res.body.updatedAt).toBeDefined();
      expect(res.body.completedAt).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain("caregiverId");
    });

    it("creates an activity directly as completed with completedAt and optional feedback", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({
          activityId: "act-ph-bahay-bahayan-01",
          scheduledDate: "2026-11-01",
          status: "completed",
          durationMinutes: 20,
          feedbackNote: "Loved the pretend tea party"
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe("completed");
      expect(res.body.completedAt).toBeDefined();
      expect(res.body.durationMinutes).toBe(20);
      expect(res.body.feedbackNote).toBe("Loved the pretend tea party");
    });

    it("lists plans for child and filters by date and status", async () => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-1", scheduledDate: "2026-11-01", status: "completed" });

      await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-2", scheduledDate: "2026-11-02", status: "planned" });

      // List all
      const listAll = await request(app)
        .get(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A);

      expect(listAll.status).toBe(200);
      expect(Array.isArray(listAll.body)).toBe(true);
      expect(listAll.body).toHaveLength(2);

      // Filter by date
      const listByDate = await request(app)
        .get(`/api/v1/children/${childA.id}/plans?date=2026-11-01`)
        .set("Authorization", AUTH_A);

      expect(listByDate.status).toBe(200);
      expect(listByDate.body).toHaveLength(1);
      expect(listByDate.body[0].activityId).toBe("act-1");

      // Filter by status
      const listByStatus = await request(app)
        .get(`/api/v1/children/${childA.id}/plans?status=planned`)
        .set("Authorization", AUTH_A);

      expect(listByStatus.status).toBe(200);
      expect(listByStatus.body).toHaveLength(1);
      expect(listByStatus.body[0].activityId).toBe("act-2");
    });

    it("patches an activity plan to toggle completion status and update notes", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-1", scheduledDate: "2026-11-01", status: "planned" });

      const planId = created.body.id;

      // Mark as completed
      const markCompleted = await request(app)
        .patch(`/api/v1/children/${childA.id}/plans/${planId}`)
        .set("Authorization", AUTH_A)
        .send({
          status: "completed",
          durationMinutes: 15,
          feedbackNote: "Enjoyed stacking blocks"
        });

      expect(markCompleted.status).toBe(200);
      expect(markCompleted.body.status).toBe("completed");
      expect(markCompleted.body.completedAt).toBeDefined();
      expect(markCompleted.body.durationMinutes).toBe(15);
      expect(markCompleted.body.feedbackNote).toBe("Enjoyed stacking blocks");

      // Mark back to planned (revert completion)
      const markPlanned = await request(app)
        .patch(`/api/v1/children/${childA.id}/plans/${planId}`)
        .set("Authorization", AUTH_A)
        .send({ status: "planned" });

      expect(markPlanned.status).toBe(200);
      expect(markPlanned.body.status).toBe("planned");
      expect(markPlanned.body.completedAt).toBeUndefined();
    });

    it("deletes a planned activity", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-1", scheduledDate: "2026-11-01" });

      const planId = created.body.id;

      const deleteRes = await request(app)
        .delete(`/api/v1/children/${childA.id}/plans/${planId}`)
        .set("Authorization", AUTH_A);

      expect(deleteRes.status).toBe(204);
      expect(deleteRes.body).toEqual({});

      // Subsequent delete returns 404
      const deleteAgain = await request(app)
        .delete(`/api/v1/children/${childA.id}/plans/${planId}`)
        .set("Authorization", AUTH_A);

      expect(deleteAgain.status).toBe(404);
      expect(deleteAgain.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("caregiver ownership isolation (BOLA defense)", () => {
    it("returns identical 404 when caregiver A attempts to access caregiver B's child plans", async () => {
      // Caregiver B creates a plan
      const bPlan = await request(app)
        .post(`/api/v1/children/${childB.id}/plans`)
        .set("Authorization", AUTH_B)
        .send({ activityId: "act-b", scheduledDate: "2026-11-01" });

      expect(bPlan.status).toBe(201);
      const planId = bPlan.body.id;

      // Caregiver A attempts list
      const listRes = await request(app)
        .get(`/api/v1/children/${childB.id}/plans`)
        .set("Authorization", AUTH_A);
      expect(listRes.status).toBe(404);
      expect(listRes.body.error.code).toBe("RESOURCE_NOT_FOUND");

      // Caregiver A attempts create
      const createRes = await request(app)
        .post(`/api/v1/children/${childB.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-hijack", scheduledDate: "2026-11-01" });
      expect(createRes.status).toBe(404);
      expect(createRes.body.error.code).toBe("RESOURCE_NOT_FOUND");

      // Caregiver A attempts patch
      const patchRes = await request(app)
        .patch(`/api/v1/children/${childB.id}/plans/${planId}`)
        .set("Authorization", AUTH_A)
        .send({ status: "completed" });
      expect(patchRes.status).toBe(404);
      expect(patchRes.body.error.code).toBe("RESOURCE_NOT_FOUND");

      // Caregiver A attempts delete
      const deleteRes = await request(app)
        .delete(`/api/v1/children/${childB.id}/plans/${planId}`)
        .set("Authorization", AUTH_A);
      expect(deleteRes.status).toBe(404);
      expect(deleteRes.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("returns identical 404 for unknown childId and malformed childId", async () => {
      const resMissing = await request(app)
        .get(`/api/v1/children/${MISSING_UUID}/plans`)
        .set("Authorization", AUTH_A);
      const resMalformed = await request(app)
        .get("/api/v1/children/not-a-uuid/plans")
        .set("Authorization", AUTH_A);

      expect(resMissing.status).toBe(404);
      expect(resMalformed.status).toBe(404);
      expect(resMissing.body).toEqual(resMalformed.body);
    });
  });

  describe("validation errors (400)", () => {
    it.each([
      ["missing activityId", { scheduledDate: "2026-11-01" }],
      ["missing scheduledDate", { activityId: "act-1" }],
      ["invalid date shape", { activityId: "act-1", scheduledDate: "2026-13-40" }],
      ["invalid calendar date", { activityId: "act-1", scheduledDate: "2026-02-31" }],
      ["invalid status enum", { activityId: "act-1", scheduledDate: "2026-11-01", status: "finished" }],
      ["duration out of range (0)", { activityId: "act-1", scheduledDate: "2026-11-01", durationMinutes: 0 }],
      ["duration out of range (200)", { activityId: "act-1", scheduledDate: "2026-11-01", durationMinutes: 200 }],
      ["disallowed extra field caregiverId", { activityId: "act-1", scheduledDate: "2026-11-01", caregiverId: "uid-a" }],
      ["disallowed extra field id", { activityId: "act-1", scheduledDate: "2026-11-01", id: MISSING_UUID }]
    ])("rejects create with %s (400)", async (_n, body) => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
      expect(Array.isArray(res.body.error.details)).toBe(true);
    });

    it.each([
      ["empty body", {}],
      ["invalid status", { status: "invalid" }],
      ["null field", { status: null }],
      ["unrecognized field", { unexpected: "value" }]
    ])("rejects patch with %s (400)", async (_n, body) => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-1", scheduledDate: "2026-11-01" });

      const res = await request(app)
        .patch(`/api/v1/children/${childA.id}/plans/${created.body.id}`)
        .set("Authorization", AUTH_A)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects invalid query parameters on list (400)", async () => {
      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/plans?status=invalidStatus`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });

  describe("error handling and resilience", () => {
    it("returns 503 with Retry-After when create is aborted by contention", async () => {
      vi.spyOn(plansStore, "create").mockRejectedValueOnce(Object.assign(new Error("contention"), { code: 10 }));

      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-1", scheduledDate: "2026-11-01" });

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("1");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("returns 503 with Retry-After when update is aborted by contention", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/plans`)
        .set("Authorization", AUTH_A)
        .send({ activityId: "act-1", scheduledDate: "2026-11-01" });

      vi.spyOn(plansStore, "update").mockRejectedValueOnce(Object.assign(new Error("contention"), { code: "aborted" }));

      const res = await request(app)
        .patch(`/api/v1/children/${childA.id}/plans/${created.body.id}`)
        .set("Authorization", AUTH_A)
        .send({ status: "completed" });

      expect(res.status).toBe(503);
      expect(res.headers["retry-after"]).toBe("1");
      expect(res.body.error.code).toBe("SERVICE_UNAVAILABLE");
    });
  });
});
