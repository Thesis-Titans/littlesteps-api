import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request, { type Response } from "supertest";

const SECRET_TOKEN_LEAK_CANARY = "secret-bearer-token-canary-999";
const SECRET_JOURNAL_CANARY = "PrivateSensitiveJournalReflectionCanary";
const SECRET_NOTE_CANARY = "PrivateFeedbackAndMilestoneNoteCanary";
const SECRET_NICKNAME_CANARY = "PrivateChildNicknameCanary";

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: async (token: string) => {
      if (!token.startsWith("uid-")) {
        throw new Error(`FirebaseAuthError: invalid token ${token} at /internal/secret/path.ts:42`);
      }
      return { uid: token, email: `${token}@example.test` };
    },
    deleteUser: async () => undefined
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
import { setAiProvider } from "../src/ai/ai-router.js";
import { FakeProvider } from "../src/ai/providers/fake.js";
import {
  createMemoryRateLimiter,
  setIpRateLimiter,
  setRateLimiter
} from "../src/ai/rate-limit.js";
import {
  setApprovedActivitiesForTest,
  setCatalogActivities
} from "../src/catalog/catalog-service.js";
import { setChildrenStore } from "../src/children/children-router.js";
import { createMemoryChildrenStore } from "../src/children/children-store.js";
import type { StoredChild } from "../src/children/types.js";
import { setMilestonesStore } from "../src/milestones/milestones-router.js";
import { createMemoryMilestonesStore } from "../src/milestones/milestones-store.js";
import { approved } from "./ai/helpers.js";

const AUTH_A = "Bearer uid-a";
const AUTH_B = "Bearer uid-b";
const CHILD_A_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_B_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_A_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_UUID = "99999999-9999-4999-8999-999999999999";
const MILESTONE_KEY = "ms-mot-12-23m-01";

let caregiversStore: ReturnType<typeof createMemoryCaregiversStore>;
let childrenStore: ReturnType<typeof createMemoryChildrenStore>;
let plansStore: ReturnType<typeof createMemoryPlansStore>;
let milestonesStore: ReturnType<typeof createMemoryMilestonesStore>;
let journalStore: ReturnType<typeof createMemoryJournalStore>;
let aiProvider: FakeProvider;
let logs: unknown[][];

function assertSafeErrorEnvelope(res: Response, expectedStatus: number, expectedCode: string): void {
  expect(res.status).toBe(expectedStatus);
  expect(res.headers["cache-control"]).toBe("no-store");
  expect(res.headers["x-powered-by"]).toBeUndefined();
  expect(res.headers["x-content-type-options"]).toBe("nosniff");
  expect(res.body).toHaveProperty("error");
  expect(res.body.error.code).toBe(expectedCode);
  expect(typeof res.body.error.message).toBe("string");

  const serialized = JSON.stringify(res.body);
  expect(serialized).not.toContain("stack");
  expect(serialized).not.toContain("FirebaseAuthError");
  expect(serialized).not.toContain("/internal/secret/path");
  expect(serialized).not.toContain(SECRET_TOKEN_LEAK_CANARY);
  expect(serialized).not.toContain(SECRET_JOURNAL_CANARY);
  expect(serialized).not.toContain(SECRET_NOTE_CANARY);
  expect(serialized).not.toContain(SECRET_NICKNAME_CANARY);
}

beforeEach(async () => {
  setAuthUserDeleter(async () => undefined);

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

  setApprovedActivitiesForTest([approved({ id: "act-ph-bahay-bahayan-01" })]);
  aiProvider = FakeProvider.valid([{ id: "act-ph-bahay-bahayan-01" }]);
  setAiProvider(aiProvider);
  setRateLimiter(createMemoryRateLimiter(10));
  setIpRateLimiter(createMemoryRateLimiter(30));

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
    displayName: "Caregiver A",
    createdAt: now,
    updatedAt: now
  });

  const childA: StoredChild = {
    id: CHILD_A_ID,
    caregiverId: "uid-a",
    name: SECRET_NICKNAME_CANARY,
    birthMonth: "2025-05",
    ageBand: "12-23m",
    createdAt: now,
    updatedAt: now
  };
  const childB: StoredChild = {
    id: CHILD_B_ID,
    caregiverId: "uid-b",
    name: "CaregiverBChild",
    birthMonth: "2024-05",
    ageBand: "24-35m",
    createdAt: now,
    updatedAt: now
  };

  await childrenStore.create("uid-a", childA);
  await childrenStore.create("uid-b", childB);

  await plansStore.create("uid-a", CHILD_A_ID, {
    id: PLAN_A_ID,
    childId: CHILD_A_ID,
    caregiverId: "uid-a",
    activityId: "act-ph-bahay-bahayan-01",
    scheduledDate: "2026-11-05",
    status: "planned",
    feedbackNote: SECRET_NOTE_CANARY,
    createdAt: now,
    updatedAt: now
  });

  await milestonesStore.create("uid-a", CHILD_A_ID, {
    id: "44444444-4444-4444-8444-444444444444",
    childId: CHILD_A_ID,
    caregiverId: "uid-a",
    milestoneId: MILESTONE_KEY,
    status: "emerging",
    observedDate: "2026-11-05",
    notes: SECRET_NOTE_CANARY,
    createdAt: now,
    updatedAt: now
  });

  await journalStore.create("uid-a", CHILD_A_ID, {
    id: "55555555-5555-4555-8555-555555555555",
    childId: CHILD_A_ID,
    caregiverId: "uid-a",
    entryDate: "2026-11-05",
    content: SECRET_JOURNAL_CANARY,
    createdAt: now,
    updatedAt: now
  });
});

afterEach(() => {
  setAuthUserDeleter(undefined);
  setCaregiversStore(undefined);
  setChildrenStore(undefined);
  setPlansStore(undefined);
  setMilestonesStore(undefined);
  setJournalStore(undefined);
  setAiProvider(null);
  setCatalogActivities([]);
  setRateLimiter(null);
  setIpRateLimiter(null);
  vi.restoreAllMocks();
});

describe("M5 Security Audit & Cross-Feature Authorization Matrix (Issue #14)", () => {
  describe("1. Unauthenticated & invalid token rejection matrix (NFR-SEC-01)", () => {
    const protectedEndpoints: Array<{
      label: string;
      method: "get" | "post" | "patch" | "delete";
      path: string;
      body?: Record<string, unknown>;
    }> = [
      { label: "GET /api/v1/me", method: "get", path: "/api/v1/me" },
      { label: "GET /api/v1/me/export", method: "get", path: "/api/v1/me/export" },
      { label: "DELETE /api/v1/me", method: "delete", path: "/api/v1/me" },
      { label: "GET /api/v1/children", method: "get", path: "/api/v1/children" },
      {
        label: "POST /api/v1/children",
        method: "post",
        path: "/api/v1/children",
        body: { nickname: "Tala", birthYear: 2025, birthMonth: 5 }
      },
      { label: "GET /api/v1/children/:childId", method: "get", path: `/api/v1/children/${CHILD_A_ID}` },
      {
        label: "PATCH /api/v1/children/:childId",
        method: "patch",
        path: `/api/v1/children/${CHILD_A_ID}`,
        body: { nickname: "Updated" }
      },
      { label: "DELETE /api/v1/children/:childId", method: "delete", path: `/api/v1/children/${CHILD_A_ID}` },
      { label: "GET /api/v1/children/:childId/plans", method: "get", path: `/api/v1/children/${CHILD_A_ID}/plans` },
      {
        label: "POST /api/v1/children/:childId/plans",
        method: "post",
        path: `/api/v1/children/${CHILD_A_ID}/plans`,
        body: { activityId: "act-ph-bahay-bahayan-01", scheduledDate: "2026-11-05" }
      },
      {
        label: "PATCH /api/v1/children/:childId/plans/:planId",
        method: "patch",
        path: `/api/v1/children/${CHILD_A_ID}/plans/${PLAN_A_ID}`,
        body: { status: "completed" }
      },
      {
        label: "DELETE /api/v1/children/:childId/plans/:planId",
        method: "delete",
        path: `/api/v1/children/${CHILD_A_ID}/plans/${PLAN_A_ID}`
      },
      {
        label: "GET /api/v1/children/:childId/milestones",
        method: "get",
        path: `/api/v1/children/${CHILD_A_ID}/milestones`
      },
      {
        label: "POST /api/v1/children/:childId/milestones",
        method: "post",
        path: `/api/v1/children/${CHILD_A_ID}/milestones`,
        body: { milestoneId: "ms-mot-12-23m-02", status: "observed" }
      },
      {
        label: "PATCH /api/v1/children/:childId/milestones/:milestoneId",
        method: "patch",
        path: `/api/v1/children/${CHILD_A_ID}/milestones/${MILESTONE_KEY}`,
        body: { status: "observed" }
      },
      {
        label: "POST /api/v1/ai/recommendations",
        method: "post",
        path: "/api/v1/ai/recommendations",
        body: { ageBand: "12-23m", timeMinutes: 15, language: "en" }
      }
    ];

    it.each(protectedEndpoints)("rejects missing token on $label with 401 UNAUTHENTICATED", async ({ method, path, body }) => {
      const req = request(app)[method](path);
      const res = body ? await req.send(body) : await req;
      assertSafeErrorEnvelope(res, 401, "UNAUTHENTICATED");
    });

    it.each(protectedEndpoints)("rejects invalid bearer token on $label without leaking token or stack", async ({ method, path, body }) => {
      const req = request(app)[method](path).set("Authorization", `Bearer ${SECRET_TOKEN_LEAK_CANARY}`);
      const res = body ? await req.send(body) : await req;
      assertSafeErrorEnvelope(res, 401, "UNAUTHENTICATED");
      expect(JSON.stringify(logs)).not.toContain(SECRET_TOKEN_LEAK_CANARY);
    });

    it("rejects non-Bearer schemes and empty bearer tokens with 401 UNAUTHENTICATED", async () => {
      for (const header of [`Basic ${SECRET_TOKEN_LEAK_CANARY}`, "Bearer ", "Bearer   "]) {
        const res = await request(app).get("/api/v1/children").set("Authorization", header);
        assertSafeErrorEnvelope(res, 401, "UNAUTHENTICATED");
      }
    });
  });

  describe("2. Cross-owner BOLA defense & child ownership matrix (NFR-SEC-02)", () => {
    const childScopedRoutes: Array<{
      label: string;
      method: "get" | "post" | "patch" | "delete";
      pathFor: (childId: string) => string;
      body?: Record<string, unknown>;
    }> = [
      {
        label: "GET /api/v1/children/:childId",
        method: "get",
        pathFor: (id) => `/api/v1/children/${id}`
      },
      {
        label: "PATCH /api/v1/children/:childId",
        method: "patch",
        pathFor: (id) => `/api/v1/children/${id}`,
        body: { nickname: "Hijacked" }
      },
      {
        label: "DELETE /api/v1/children/:childId",
        method: "delete",
        pathFor: (id) => `/api/v1/children/${id}`
      },
      {
        label: "GET /api/v1/children/:childId/plans",
        method: "get",
        pathFor: (id) => `/api/v1/children/${id}/plans`
      },
      {
        label: "POST /api/v1/children/:childId/plans",
        method: "post",
        pathFor: (id) => `/api/v1/children/${id}/plans`,
        body: { activityId: "act-ph-bahay-bahayan-01", scheduledDate: "2026-11-05" }
      },
      {
        label: "PATCH /api/v1/children/:childId/plans/:planId",
        method: "patch",
        pathFor: (id) => `/api/v1/children/${id}/plans/${PLAN_A_ID}`,
        body: { status: "completed", feedbackNote: "Hijacked" }
      },
      {
        label: "DELETE /api/v1/children/:childId/plans/:planId",
        method: "delete",
        pathFor: (id) => `/api/v1/children/${id}/plans/${PLAN_A_ID}`
      },
      {
        label: "GET /api/v1/children/:childId/milestones",
        method: "get",
        pathFor: (id) => `/api/v1/children/${id}/milestones`
      },
      {
        label: "POST /api/v1/children/:childId/milestones",
        method: "post",
        pathFor: (id) => `/api/v1/children/${id}/milestones`,
        body: { milestoneId: "ms-mot-12-23m-02", status: "observed" }
      },
      {
        label: "PATCH /api/v1/children/:childId/milestones/:milestoneId",
        method: "patch",
        pathFor: (id) => `/api/v1/children/${id}/milestones/${MILESTONE_KEY}`,
        body: { status: "observed", notes: "Hijacked" }
      }
    ];

    it.each(childScopedRoutes)(
      "returns identical 404 RESOURCE_NOT_FOUND for cross-owner, missing UUID, and malformed UUID on $label",
      async ({ method, pathFor, body }) => {
        const send = (childId: string) => {
          const req = request(app)[method](pathFor(childId)).set("Authorization", AUTH_B);
          return body ? req.send(body) : req;
        };

        const crossOwnerRes = await send(CHILD_A_ID);
        const missingRes = await send(MISSING_UUID);
        const malformedRes = await send("not-a-valid-uuid");

        assertSafeErrorEnvelope(crossOwnerRes, 404, "RESOURCE_NOT_FOUND");
        assertSafeErrorEnvelope(missingRes, 404, "RESOURCE_NOT_FOUND");
        assertSafeErrorEnvelope(malformedRes, 404, "RESOURCE_NOT_FOUND");

        expect(crossOwnerRes.body).toEqual(missingRes.body);
        expect(crossOwnerRes.body).toEqual(malformedRes.body);
      }
    );

    it("preserves Caregiver A's child, plans, and milestones untouched after Caregiver B's cross-owner attempts", async () => {
      await request(app).delete(`/api/v1/children/${CHILD_A_ID}`).set("Authorization", AUTH_B);
      await request(app)
        .patch(`/api/v1/children/${CHILD_A_ID}/plans/${PLAN_A_ID}`)
        .set("Authorization", AUTH_B)
        .send({ status: "completed" });
      await request(app)
        .patch(`/api/v1/children/${CHILD_A_ID}/milestones/${MILESTONE_KEY}`)
        .set("Authorization", AUTH_B)
        .send({ status: "observed" });

      const childCheck = await childrenStore.get("uid-a", CHILD_A_ID);
      expect(childCheck?.name).toBe(SECRET_NICKNAME_CANARY);

      const plansCheck = await plansStore.list("uid-a", CHILD_A_ID, {});
      expect(plansCheck).toHaveLength(1);
      expect(plansCheck[0].status).toBe("planned");
      expect(plansCheck[0].feedbackNote).toBe(SECRET_NOTE_CANARY);

      const milestonesCheck = await milestonesStore.list("uid-a", CHILD_A_ID, {});
      expect(milestonesCheck).toHaveLength(1);
      expect(milestonesCheck[0].status).toBe("emerging");
      expect(milestonesCheck[0].notes).toBe(SECRET_NOTE_CANARY);
    });

    it("rejects client-supplied caregiverId/uid overrides across write payloads", async () => {
      const childCreate = await request(app)
        .post("/api/v1/children")
        .set("Authorization", AUTH_B)
        .send({ nickname: "Tala", birthYear: 2025, birthMonth: 5, caregiverId: "uid-a" });
      assertSafeErrorEnvelope(childCreate, 400, "INVALID_INPUT");

      const planCreate = await request(app)
        .post(`/api/v1/children/${CHILD_B_ID}/plans`)
        .set("Authorization", AUTH_B)
        .send({
          activityId: "act-ph-bahay-bahayan-01",
          scheduledDate: "2026-11-05",
          caregiverId: "uid-a"
        });
      assertSafeErrorEnvelope(planCreate, 400, "INVALID_INPUT");

      const milestoneCreate = await request(app)
        .post(`/api/v1/children/${CHILD_B_ID}/milestones`)
        .set("Authorization", AUTH_B)
        .send({
          milestoneId: MILESTONE_KEY,
          status: "observed",
          caregiverId: "uid-a"
        });
      assertSafeErrorEnvelope(milestoneCreate, 400, "INVALID_INPUT");

      const aiReq = await request(app)
        .post("/api/v1/ai/recommendations")
        .set("Authorization", AUTH_B)
        .send({
          ageBand: "12-23m",
          timeMinutes: 15,
          language: "en",
          childId: CHILD_A_ID,
          caregiverId: "uid-a"
        });
      assertSafeErrorEnvelope(aiReq, 400, "INVALID_INPUT");
    });
  });

  describe("3. Error envelope & log hygiene audit (NFR-SEC-04, NFR-PRIV-02)", () => {
    it("strips internal stack traces, paths, tokens, and journal text on unexpected 500 errors", async () => {
      vi.spyOn(childrenStore, "list").mockRejectedValueOnce(
        new Error(
          `Database crash for ${SECRET_TOKEN_LEAK_CANARY} note=${SECRET_JOURNAL_CANARY} at /srv/app/children.ts:99`
        )
      );

      const res = await request(app).get("/api/v1/children").set("Authorization", AUTH_A);
      assertSafeErrorEnvelope(res, 500, "INTERNAL_ERROR");
      expect(res.body).toEqual({
        error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" }
      });
      expect(logs).toEqual([]);
    });

    it("returns standardized 503 SERVICE_UNAVAILABLE with Retry-After on Firestore contention", async () => {
      vi.spyOn(plansStore, "create").mockRejectedValueOnce(
        Object.assign(new Error(`10 ABORTED: transaction contention for ${SECRET_NOTE_CANARY}`), {
          code: 10
        })
      );

      const res = await request(app)
        .post(`/api/v1/children/${CHILD_A_ID}/plans`)
        .set("Authorization", AUTH_A)
        .send({
          activityId: "act-ph-bahay-bahayan-01",
          scheduledDate: "2026-11-05",
          feedbackNote: SECRET_NOTE_CANARY
        });

      assertSafeErrorEnvelope(res, 503, "SERVICE_UNAVAILABLE");
      expect(res.headers["retry-after"]).toBe("1");
      expect(logs).toEqual([]);
    });

    it("never echoes rejected private notes or journal text in 400/422 validation error envelopes", async () => {
      const futureMilestone = await request(app)
        .post(`/api/v1/children/${CHILD_A_ID}/milestones`)
        .set("Authorization", AUTH_A)
        .send({
          milestoneId: MILESTONE_KEY,
          status: "observed",
          observedDate: "2099-01-01",
          notes: SECRET_NOTE_CANARY
        });

      assertSafeErrorEnvelope(futureMilestone, 422, "UNPROCESSABLE_ENTITY");
      expect(logs).toEqual([]);
    });
  });

  describe("4. CORS, security headers, rate limits & AI prompt privacy guardrails (NFR-SEC-03..04, NFR-REL-01, NFR-AI-02)", () => {
    it("rejects wildcard and untrusted origins with 403 ORIGIN_NOT_ALLOWED", async () => {
      for (const origin of ["https://attacker.example.com", "null", "*"]) {
        const res = await request(app)
          .get("/api/v1/children")
          .set("Origin", origin)
          .set("Authorization", AUTH_A);
        assertSafeErrorEnvelope(res, 403, "ORIGIN_NOT_ALLOWED");
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      }
    });

    it("enforces AI rate limiting (429 + Retry-After) and excludes PII from AI provider inputs", async () => {
      setRateLimiter(createMemoryRateLimiter(1));

      const first = await request(app)
        .post("/api/v1/ai/recommendations")
        .set("Authorization", AUTH_A)
        .send({
          ageBand: "12-23m",
          timeMinutes: 15,
          setting: "indoor",
          materials: ["plastic cups", "spoons"],
          language: "en"
        });
      expect(first.status).toBe(200);
      expect(first.headers["cache-control"]).toBe("no-store");

      const promptInput = aiProvider.prompts[0] ?? "";
      expect(promptInput).not.toContain("uid-a");
      expect(promptInput).not.toContain("caregiver-a@example.test");
      expect(promptInput).not.toContain(SECRET_NICKNAME_CANARY);
      expect(promptInput).not.toContain(SECRET_JOURNAL_CANARY);
      expect(promptInput).not.toContain(SECRET_NOTE_CANARY);

      const second = await request(app)
        .post("/api/v1/ai/recommendations")
        .set("Authorization", AUTH_A)
        .send({
          ageBand: "12-23m",
          timeMinutes: 15,
          language: "en"
        });
      assertSafeErrorEnvelope(second, 429, "RATE_LIMITED");
      expect(Number(second.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(aiProvider.calls).toBe(1);
    });
  });
});
