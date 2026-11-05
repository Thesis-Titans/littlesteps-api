import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const deleteUserMock = vi.fn<(uid: string) => Promise<void>>();

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("uid-")) throw new Error("bad token");
      return { uid: token, email: `${token}@example.test` };
    },
    deleteUser: (uid: string) => deleteUserMock(uid)
  })
}));

import { app } from "../src/app.js";
import {
  setAuthUserDeleter,
  setCaregiversStore,
  setJournalStore
} from "../src/account/account-router.js";
import {
  createMemoryCaregiversStore,
  createMemoryJournalStore
} from "../src/account/account-store.js";
import { setPlansStore } from "../src/activities/activities-router.js";
import { createMemoryPlansStore } from "../src/activities/activities-store.js";
import { setChildrenStore } from "../src/children/children-router.js";
import { createMemoryChildrenStore } from "../src/children/children-store.js";
import type { StoredChild } from "../src/children/types.js";
import { setMilestonesStore } from "../src/milestones/milestones-router.js";
import { createMemoryMilestonesStore } from "../src/milestones/milestones-store.js";

const AUTH_A = "Bearer uid-a";
const AUTH_B = "Bearer uid-b";
const MISSING_UUID = "8c2bce8d-9066-428d-aafa-c26761845c6e";

let caregiversStore: ReturnType<typeof createMemoryCaregiversStore>;
let childrenStore: ReturnType<typeof createMemoryChildrenStore>;
let plansStore: ReturnType<typeof createMemoryPlansStore>;
let milestonesStore: ReturnType<typeof createMemoryMilestonesStore>;
let journalStore: ReturnType<typeof createMemoryJournalStore>;
let childA: StoredChild;
let childB: StoredChild;
let logs: unknown[][];

beforeEach(async () => {
  deleteUserMock.mockReset();
  deleteUserMock.mockResolvedValue(undefined);
  setAuthUserDeleter(undefined);

  caregiversStore = createMemoryCaregiversStore();
  childrenStore = createMemoryChildrenStore();
  plansStore = createMemoryPlansStore();
  milestonesStore = createMemoryMilestonesStore();
  journalStore = createMemoryJournalStore();

  setCaregiversStore(caregiversStore);
  setChildrenStore(childrenStore);
  setPlansStore(plansStore);
  setMilestonesStore(milestonesStore);
  setJournalStore(journalStore);

  logs = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => {
      logs.push(args);
    });
  }

  const now = "2026-11-05T08:00:00.000Z";
  caregiversStore.data.set("uid-a", {
    uid: "uid-a",
    email: "caregiver-a@example.test",
    displayName: "Caregiver Secret Name A",
    weatherLocation: { name: "Iloilo City", latitude: 10.72, longitude: 122.56 },
    createdAt: now,
    updatedAt: now
  });
  caregiversStore.data.set("uid-b", {
    uid: "uid-b",
    email: "caregiver-b@example.test",
    displayName: "Caregiver Secret Name B",
    createdAt: now,
    updatedAt: now
  });

  childA = {
    id: "11111111-1111-4111-8111-111111111111",
    caregiverId: "uid-a",
    name: "SecretNicknameA",
    birthMonth: "2025-08",
    ageBand: "12-23m",
    createdAt: now,
    updatedAt: now
  };
  childB = {
    id: "22222222-2222-4222-8222-222222222222",
    caregiverId: "uid-b",
    name: "SecretNicknameB",
    birthMonth: "2024-06",
    ageBand: "24-35m",
    createdAt: now,
    updatedAt: now
  };

  await childrenStore.create("uid-a", childA);
  await childrenStore.create("uid-b", childB);

  await plansStore.create("uid-a", childA.id, {
    id: "33333333-3333-4333-8333-333333333333",
    childId: childA.id,
    caregiverId: "uid-a",
    activityId: "act-ph-bahay-bahayan-01",
    scheduledDate: "2026-11-05",
    status: "completed",
    completedAt: now,
    durationMinutes: 15,
    feedbackNote: "SecretPlanNoteA",
    createdAt: now,
    updatedAt: now
  });
  await plansStore.create("uid-b", childB.id, {
    id: "44444444-4444-4444-8444-444444444444",
    childId: childB.id,
    caregiverId: "uid-b",
    activityId: "act-ph-2",
    scheduledDate: "2026-11-05",
    status: "planned",
    feedbackNote: "SecretPlanNoteB",
    createdAt: now,
    updatedAt: now
  });

  await milestonesStore.create("uid-a", childA.id, {
    id: "55555555-5555-4555-8555-555555555555",
    childId: childA.id,
    caregiverId: "uid-a",
    milestoneId: "ms-mot-12-23m-01",
    status: "observed",
    observedDate: "2026-11-05",
    notes: "SecretMilestoneNoteA",
    createdAt: now,
    updatedAt: now
  });
  await milestonesStore.create("uid-b", childB.id, {
    id: "66666666-6666-4666-8666-666666666666",
    childId: childB.id,
    caregiverId: "uid-b",
    milestoneId: "ms-mot-24-35m-01",
    status: "not_yet_observed",
    observedDate: "2026-11-05",
    notes: "SecretMilestoneNoteB",
    createdAt: now,
    updatedAt: now
  });

  await journalStore.create("uid-a", childA.id, {
    id: "77777777-7777-4777-8777-777777777777",
    childId: childA.id,
    caregiverId: "uid-a",
    entryDate: "2026-11-05",
    content: "SecretJournalEntryA",
    linkedMilestoneId: "ms-mot-12-23m-01",
    createdAt: now,
    updatedAt: now
  });
  await journalStore.create("uid-b", childB.id, {
    id: "88888888-8888-4888-8888-888888888888",
    childId: childB.id,
    caregiverId: "uid-b",
    entryDate: "2026-11-05",
    content: "SecretJournalEntryB",
    createdAt: now,
    updatedAt: now
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("data export and deletion API (#17)", () => {
  describe("authentication", () => {
    it("returns 401 without a valid bearer token on export and delete routes", async () => {
      const requests = [
        request(app).get("/api/v1/me/export"),
        request(app).delete("/api/v1/me"),
        request(app).delete(`/api/v1/children/${childA.id}`),
        request(app).get("/api/v1/me/export").set("Authorization", "Bearer invalid"),
        request(app).delete("/api/v1/me").set("Authorization", "Bearer invalid"),
        request(app).delete(`/api/v1/children/${childA.id}`).set("Authorization", "Bearer invalid")
      ];

      for (const req of requests) {
        const res = await req;
        expect(res.status).toBe(401);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
      }
    });
  });

  describe("GET /api/v1/me/export", () => {
    it("exports only the signed-in caregiver's profile, children, plans, observations and journal entries", async () => {
      const res = await request(app).get("/api/v1/me/export").set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(res.body.profile).toEqual({
        uid: "uid-a",
        email: "caregiver-a@example.test",
        displayName: "Caregiver Secret Name A",
        weatherLocation: { name: "Iloilo City", latitude: 10.72, longitude: 122.56 },
        createdAt: "2026-11-05T08:00:00.000Z",
        updatedAt: "2026-11-05T08:00:00.000Z"
      });
      expect(res.body.children).toHaveLength(1);
      expect(res.body.children[0]).toMatchObject({
        id: childA.id,
        nickname: "SecretNicknameA",
        birthMonthYear: "2025-08",
        ageBand: "12-23m"
      });
      expect(res.body.plans).toEqual([
        {
          id: "33333333-3333-4333-8333-333333333333",
          childId: childA.id,
          activityId: "act-ph-bahay-bahayan-01",
          scheduledDate: "2026-11-05",
          status: "completed",
          completedAt: "2026-11-05T08:00:00.000Z",
          durationMinutes: 15,
          feedbackNote: "SecretPlanNoteA",
          createdAt: "2026-11-05T08:00:00.000Z",
          updatedAt: "2026-11-05T08:00:00.000Z"
        }
      ]);
      expect(res.body.observations).toEqual([
        {
          id: "55555555-5555-4555-8555-555555555555",
          childId: childA.id,
          milestoneId: "ms-mot-12-23m-01",
          status: "observed",
          observedDate: "2026-11-05",
          notes: "SecretMilestoneNoteA",
          createdAt: "2026-11-05T08:00:00.000Z",
          updatedAt: "2026-11-05T08:00:00.000Z"
        }
      ]);
      expect(res.body.journalEntries).toEqual([
        {
          id: "77777777-7777-4777-8777-777777777777",
          childId: childA.id,
          entryDate: "2026-11-05",
          content: "SecretJournalEntryA",
          linkedMilestoneId: "ms-mot-12-23m-01",
          createdAt: "2026-11-05T08:00:00.000Z",
          updatedAt: "2026-11-05T08:00:00.000Z"
        }
      ]);

      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("caregiverId");
      expect(serialized).not.toContain("uid-b");
      expect(serialized).not.toContain("SecretNicknameB");
      expect(serialized).not.toContain("SecretPlanNoteB");
      expect(serialized).not.toContain("SecretMilestoneNoteB");
      expect(serialized).not.toContain("SecretJournalEntryB");

      const resB = await request(app).get("/api/v1/me/export").set("Authorization", AUTH_B);
      expect(resB.status).toBe(200);
      expect(resB.body.profile.uid).toBe("uid-b");
      expect(JSON.stringify(resB.body)).not.toContain("uid-a");
      expect(logs).toEqual([]);


    });

    it("returns empty arrays and token fallback profile when the caregiver has no stored documents", async () => {
      const res = await request(app).get("/api/v1/me/export").set("Authorization", "Bearer uid-empty");

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        profile: { uid: "uid-empty", email: "uid-empty@example.test" },
        children: [],
        plans: [],
        observations: [],
        journalEntries: []
      });

    });

    it("returns 404 RESOURCE_NOT_FOUND on cross-account export attempts", async () => {
      const attempts = [
        request(app).get("/api/v1/me/export?uid=uid-b").set("Authorization", AUTH_A),
        request(app).get("/api/v1/me/export?caregiverId=uid-b").set("Authorization", AUTH_A),
        request(app).get(`/api/v1/me/export?childId=${childB.id}`).set("Authorization", AUTH_A),
        request(app).get(`/api/v1/me/export?childId=${MISSING_UUID}`).set("Authorization", AUTH_A),
        request(app).get("/api/v1/me/export?childId=not-a-uuid").set("Authorization", AUTH_A)
      ];

      for (const req of attempts) {
        const res = await req;
        expect(res.status).toBe(404);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });
      }

    });
  });

  describe("DELETE /api/v1/children/:childId", () => {
    it("permanently deletes an owned child and all child-scoped records without logging content", async () => {
      const res = await request(app)
        .delete(`/api/v1/children/${childA.id}`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
      expect(res.headers["cache-control"]).toBe("no-store");

      expect(await childrenStore.get("uid-a", childA.id)).toBeNull();
      expect(await plansStore.list("uid-a", childA.id)).toEqual([]);
      expect(await milestonesStore.list("uid-a", childA.id)).toEqual([]);
      expect(await journalStore.list("uid-a", childA.id)).toEqual([]);

      // Caregiver B's child and records remain untouched
      expect(await childrenStore.get("uid-b", childB.id)).not.toBeNull();
      expect(await plansStore.list("uid-b", childB.id)).toHaveLength(1);
      expect(await milestonesStore.list("uid-b", childB.id)).toHaveLength(1);
      expect(await journalStore.list("uid-b", childB.id)).toHaveLength(1);

      // Only the fact and id of the deletion are logged; never PII or notes
      const logged = JSON.stringify(logs);
      expect(logged).toContain("child.deleted");
      expect(logged).toContain(childA.id);
      expect(logged).not.toContain("SecretNicknameA");
      expect(logged).not.toContain("2025-08");
      expect(logged).not.toContain("SecretPlanNoteA");
      expect(logged).not.toContain("SecretMilestoneNoteA");
      expect(logged).not.toContain("SecretJournalEntryA");
    });

    it("returns identical 404s for another caregiver's child, a missing child, and a malformed id", async () => {
      const responses = [
        await request(app).delete(`/api/v1/children/${childB.id}`).set("Authorization", AUTH_A),
        await request(app).delete(`/api/v1/children/${MISSING_UUID}`).set("Authorization", AUTH_A),
        await request(app).delete("/api/v1/children/not-a-uuid").set("Authorization", AUTH_A)
      ];

      for (const r of responses) {
        expect(r.status).toBe(404);
        expect(r.text).toBe(responses[0].text);
        expect(r.headers["cache-control"]).toBe("no-store");
        expect(r.body).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });
      }

      // Caregiver B's child and subcollections are untouched
      expect(await childrenStore.get("uid-b", childB.id)).not.toBeNull();
      expect(await plansStore.list("uid-b", childB.id)).toHaveLength(1);
      expect(await milestonesStore.list("uid-b", childB.id)).toHaveLength(1);
      expect(await journalStore.list("uid-b", childB.id)).toHaveLength(1);

    });

    it("returns 503 on contention and 500 on unexpected store failure", async () => {
      vi.spyOn(childrenStore, "delete").mockRejectedValueOnce(Object.assign(new Error("aborted"), { code: 10 }));
      const conflict = await request(app).delete(`/api/v1/children/${childA.id}`).set("Authorization", AUTH_A);
      expect(conflict.status).toBe(503);
      expect(conflict.headers["retry-after"]).toBe("1");

      vi.spyOn(childrenStore, "delete").mockRejectedValueOnce(new Error("boom"));
      const failure = await request(app).delete(`/api/v1/children/${childA.id}`).set("Authorization", AUTH_A);
      expect(failure.status).toBe(500);
      expect(failure.body.error.code).toBe("INTERNAL_ERROR");

    });
  });

  describe("DELETE /api/v1/me", () => {
    it("deletes children and subcollections first, then the caregiver document, then the Auth user last", async () => {
      const order: string[] = [];
      const origDeleteChild = childrenStore.delete.bind(childrenStore);
      vi.spyOn(childrenStore, "delete").mockImplementation(async (uid, id) => {
        order.push(`child:${id}`);
        return origDeleteChild(uid, id);
      });
      const origDeleteCaregiver = caregiversStore.deleteCaregiver.bind(caregiversStore);
      vi.spyOn(caregiversStore, "deleteCaregiver").mockImplementation(async (uid) => {
        order.push(`caregiver:${uid}`);
        return origDeleteCaregiver(uid);
      });
      deleteUserMock.mockImplementation(async (uid) => {
        order.push(`auth:${uid}`);
      });

      const res = await request(app).delete("/api/v1/me").set("Authorization", AUTH_A);

      expect(res.status).toBe(204);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(order).toEqual([`child:${childA.id}`, "caregiver:uid-a", "auth:uid-a"]);

      expect(await childrenStore.list("uid-a")).toEqual([]);
      expect(await plansStore.list("uid-a", childA.id)).toEqual([]);
      expect(await milestonesStore.list("uid-a", childA.id)).toEqual([]);
      expect(await journalStore.list("uid-a", childA.id)).toEqual([]);
      expect(await caregiversStore.getProfile("uid-a")).toBeNull();
      expect(deleteUserMock).toHaveBeenCalledWith("uid-a");

      // Caregiver B is completely untouched
      expect(await caregiversStore.getProfile("uid-b")).not.toBeNull();
      expect(await childrenStore.list("uid-b")).toHaveLength(1);
      expect(await plansStore.list("uid-b", childB.id)).toHaveLength(1);
      expect(await milestonesStore.list("uid-b", childB.id)).toHaveLength(1);
      expect(await journalStore.list("uid-b", childB.id)).toHaveLength(1);

      // Log hygiene: only event and uid, never PII or notes
      const logged = JSON.stringify(logs);
      expect(logged).toContain("account.deleted");
      expect(logged).toContain("uid-a");
      expect(logged).not.toContain("caregiver-a@example.test");
      expect(logged).not.toContain("Caregiver Secret Name A");
      expect(logged).not.toContain("SecretNicknameA");
      expect(logged).not.toContain("SecretPlanNoteA");
      expect(logged).not.toContain("SecretMilestoneNoteA");
      expect(logged).not.toContain("SecretJournalEntryA");
    });

    it("returns 500 if a deletion step fails and succeeds cleanly when retried (decision D5)", async () => {
      deleteUserMock.mockRejectedValueOnce(new Error("auth service down"));

      const first = await request(app).delete("/api/v1/me").set("Authorization", AUTH_A);
      expect(first.status).toBe(500);
      expect(first.body.error.code).toBe("INTERNAL_ERROR");


      const retry = await request(app).delete("/api/v1/me").set("Authorization", AUTH_A);
      expect(retry.status).toBe(204);
      expect(deleteUserMock).toHaveBeenCalledTimes(2);
    });

    it("returns 404 on cross-account deletion attempts and deletes nothing", async () => {
      const attempts = [
        request(app).delete("/api/v1/me?uid=uid-b").set("Authorization", AUTH_A),
        request(app).delete("/api/v1/me?caregiverId=uid-b").set("Authorization", AUTH_A),
        request(app).delete("/api/v1/me").set("Authorization", AUTH_A).send({ uid: "uid-b" })
      ];

      for (const req of attempts) {
        const res = await req;
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });
      }

      expect(await caregiversStore.getProfile("uid-a")).not.toBeNull();
      expect(await caregiversStore.getProfile("uid-b")).not.toBeNull();
      expect(deleteUserMock).not.toHaveBeenCalled();
      expect(logs).toEqual([]);

    });
  });
});
