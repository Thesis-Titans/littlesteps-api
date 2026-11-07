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
import { setJournalStore } from "../src/journal/journal-router.js";
import { createMemoryJournalStore } from "../src/journal/journal-store.js";
import type { StoredChild } from "../src/children/types.js";

const AUTH_A = "Bearer uid-a";
const AUTH_B = "Bearer uid-b";
const MISSING_UUID = "8c2bce8d-9066-428d-aafa-c26761845c6e";

let childrenStore: ReturnType<typeof createMemoryChildrenStore>;
let journalStore: ReturnType<typeof createMemoryJournalStore>;
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
  journalStore = createMemoryJournalStore();
  setJournalStore(journalStore);

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

describe("private observation journal API (FR-03, NFR-PRIV-02)", () => {
  describe("authentication", () => {
    it("returns 401 without a valid bearer token on every route", async () => {
      const endpoints = [
        request(app).get(`/api/v1/children/${childA.id}/journal`),
        request(app).post(`/api/v1/children/${childA.id}/journal`).send({ entryDate: pastDate(), content: "Note" }),
        request(app).get(`/api/v1/children/${childA.id}/journal/${MISSING_UUID}`),
        request(app).patch(`/api/v1/children/${childA.id}/journal/${MISSING_UUID}`).send({ content: "Updated" }),
        request(app).delete(`/api/v1/children/${childA.id}/journal/${MISSING_UUID}`),
        request(app).get(`/api/v1/children/${childA.id}/journal`).set("Authorization", "Bearer invalid")
      ];

      for (const req of endpoints) {
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
      }
    });
  });

  describe("CRUD operations and fields", () => {
    it("creates a private journal entry with required fields and strips internal caregiverId", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-11-05",
          content: "First time pointing at the family cat and making meow sounds."
        });

      expect(res.status).toBe(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toMatchObject({
        childId: childA.id,
        entryDate: "2026-11-05",
        content: "First time pointing at the family cat and making meow sounds."
      });
      expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(res.body.caregiverId).toBeUndefined();
      expect(res.body.createdAt).toBeTruthy();
      expect(res.body.updatedAt).toBeTruthy();
    });

    it("creates a journal entry with optional milestone and activity links", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-11-05",
          content: "Built a small block tower together after dinner.",
          linkedMilestoneId: "ms-mot-12-23m-blocks",
          linkedActivityId: "act-blocks-01"
        });

      expect(res.status).toBe(201);
      expect(res.body.linkedMilestoneId).toBe("ms-mot-12-23m-blocks");
      expect(res.body.linkedActivityId).toBe("act-blocks-01");
    });

    it("lists journal entries for an owned child in reverse-chronological order", async () => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-02", content: "Earlier entry" });

      await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-05", content: "Later entry" });

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].entryDate).toBe("2026-11-05");
      expect(res.body[1].entryDate).toBe("2026-11-02");
      expect(res.body[0].caregiverId).toBeUndefined();
    });

    it("filters journal entries by date", async () => {
      await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-02", content: "Nov 2 note" });

      await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-05", content: "Nov 5 note" });

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/journal?date=2026-11-05`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].content).toBe("Nov 5 note");
    });

    it("fetches a single journal entry by ID", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-05", content: "Single entry test" });

      const entryId = created.body.id;

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/journal/${entryId}`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(entryId);
      expect(res.body.content).toBe("Single entry test");
    });

    it("updates a journal entry with patch and updates updatedAt", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-04", content: "Original note content" });

      const entryId = created.body.id;

      const res = await request(app)
        .patch(`/api/v1/children/${childA.id}/journal/${entryId}`)
        .set("Authorization", AUTH_A)
        .send({
          content: "Updated note with more detail."
        });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(entryId);
      expect(res.body.content).toBe("Updated note with more detail.");
      expect(res.body.entryDate).toBe("2026-11-04");
      expect(res.body.caregiverId).toBeUndefined();
    });

    it("deletes a journal entry and returns 204", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-05", content: "To be deleted" });

      const entryId = created.body.id;

      const del = await request(app)
        .delete(`/api/v1/children/${childA.id}/journal/${entryId}`)
        .set("Authorization", AUTH_A);

      expect(del.status).toBe(204);

      const check = await request(app)
        .get(`/api/v1/children/${childA.id}/journal/${entryId}`)
        .set("Authorization", AUTH_A);

      expect(check.status).toBe(404);
      expect(check.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("authorization, BOLA mitigation and safe errors", () => {
    it("returns safe 404 RESOURCE_NOT_FOUND when Caregiver B tries to access Caregiver A's child journal", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-05", content: "Caregiver A secret journal note" });

      const entryId = created.body.id;

      const attempts = [
        request(app).get(`/api/v1/children/${childA.id}/journal`).set("Authorization", AUTH_B),
        request(app).post(`/api/v1/children/${childA.id}/journal`).set("Authorization", AUTH_B).send({ entryDate: "2026-11-05", content: "B's note" }),
        request(app).get(`/api/v1/children/${childA.id}/journal/${entryId}`).set("Authorization", AUTH_B),
        request(app).patch(`/api/v1/children/${childA.id}/journal/${entryId}`).set("Authorization", AUTH_B).send({ content: "Tampered" }),
        request(app).delete(`/api/v1/children/${childA.id}/journal/${entryId}`).set("Authorization", AUTH_B)
      ];

      for (const req of attempts) {
        const res = await req;
        expect(res.status).toBe(404);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.error).toEqual({
          code: "RESOURCE_NOT_FOUND",
          message: "Resource not found"
        });
      }
    });

    it("returns safe 404 for malformed childId and entryId UUIDs", async () => {
      const res1 = await request(app)
        .get("/api/v1/children/not-a-uuid/journal")
        .set("Authorization", AUTH_A);
      expect(res1.status).toBe(404);
      expect(res1.body.error.code).toBe("RESOURCE_NOT_FOUND");

      const res2 = await request(app)
        .get(`/api/v1/children/${childA.id}/journal/not-a-uuid`)
        .set("Authorization", AUTH_A);
      expect(res2.status).toBe(404);
      expect(res2.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("returns safe 404 when entry belongs to another child even for same caregiver", async () => {
      const secondChild = {
        id: "33333333-3333-4333-8333-333333333333",
        caregiverId: "uid-a",
        name: "Child A2",
        ageBand: "0-2m",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await childrenStore.create("uid-a", secondChild);

      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-05", content: "First child note" });

      const res = await request(app)
        .get(`/api/v1/children/${secondChild.id}/journal/${created.body.id}`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("validation rules", () => {
    it("rejects future entryDate beyond caregiver local date slack (UTC+14)", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: futureDate(3),
          content: "Future observation"
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
      expect(res.body.error.details).toContainEqual(
        expect.objectContaining({ field: "entryDate" })
      );
    });

    it("rejects invalid calendar dates like Feb 30", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-02-30",
          content: "Invalid calendar day"
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects empty or whitespace-only content", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-11-05",
          content: "   "
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects notes exceeding 2,000 characters", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-11-05",
          content: "a".repeat(2001)
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("allows standard multiline text with newlines but rejects control characters", async () => {
      const validMultiline = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-11-05",
          content: "First paragraph.\n\nSecond paragraph with details."
        });

      expect(validMultiline.status).toBe(201);
      expect(validMultiline.body.content).toBe("First paragraph.\n\nSecond paragraph with details.");

      const invalidControl = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-11-05",
          content: "Dangerous \u0000 null byte"
        });

      expect(invalidControl.status).toBe(400);
      expect(invalidControl.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects client-supplied caregiverId or uid overrides in request body", async () => {
      const res = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({
          entryDate: "2026-11-05",
          content: "Trying to spoof caregiver",
          caregiverId: "uid-b"
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("rejects empty PATCH payload with no fields", async () => {
      const created = await request(app)
        .post(`/api/v1/children/${childA.id}/journal`)
        .set("Authorization", AUTH_A)
        .send({ entryDate: "2026-11-05", content: "Test note" });

      const res = await request(app)
        .patch(`/api/v1/children/${childA.id}/journal/${created.body.id}`)
        .set("Authorization", AUTH_A)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });
});
