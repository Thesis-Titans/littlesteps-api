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
import { setMilestonesStore } from "../src/milestones/milestones-router.js";
import { createMemoryMilestonesStore } from "../src/milestones/milestones-store.js";
import type { StoredChild } from "../src/children/types.js";
import { currentIsoWeek, isoWeekBounds } from "../src/summary/summary-service.js";

const AUTH_A = "Bearer uid-a";
const AUTH_B = "Bearer uid-b";
const MISSING_UUID = "8c2bce8d-9066-428d-aafa-c26761845c6e";

let childrenStore: ReturnType<typeof createMemoryChildrenStore>;
let plansStore: ReturnType<typeof createMemoryPlansStore>;
let milestonesStore: ReturnType<typeof createMemoryMilestonesStore>;
let childA: StoredChild;
let childB: StoredChild;

beforeEach(async () => {
  childrenStore = createMemoryChildrenStore();
  setChildrenStore(childrenStore);
  plansStore = createMemoryPlansStore();
  setPlansStore(plansStore);
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

describe("Weekly Summary API (FR-05)", () => {
  describe("Authentication & Authorization", () => {
    it("returns 401 when no authorization token is provided", async () => {
      const res = await request(app).get(`/api/v1/children/${childA.id}/summary/weekly`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 401 when token is invalid", async () => {
      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly`)
        .set("Authorization", "Bearer invalid-token");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("returns 404 when childId is not a valid UUIDv4", async () => {
      const res = await request(app)
        .get("/api/v1/children/not-a-uuid/summary/weekly")
        .set("Authorization", AUTH_A);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("returns 404 when child profile does not exist", async () => {
      const res = await request(app)
        .get(`/api/v1/children/${MISSING_UUID}/summary/weekly`)
        .set("Authorization", AUTH_A);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });

    it("enforces tenant authorization (BOLA): returns 404 when Caregiver A accesses Caregiver B's child and vice versa", async () => {
      const resA = await request(app)
        .get(`/api/v1/children/${childB.id}/summary/weekly`)
        .set("Authorization", AUTH_A);
      expect(resA.status).toBe(404);
      expect(resA.body.error.code).toBe("RESOURCE_NOT_FOUND");

      const resB = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly`)
        .set("Authorization", AUTH_B);
      expect(resB.status).toBe(404);
      expect(resB.body.error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });

  describe("Query Parameter Validation (?week=)", () => {
    it.each([
      ["missing 'W' delimiter", "2026-11-06"],
      ["week 00 out of range", "2026-W00"],
      ["week 54 out of range", "2026-W54"],
      ["non-numeric characters", "2026-Wxx"],
      ["arbitrary string", "last-week"]
    ])("returns 400 INVALID_INPUT for %s", async (_label, invalidWeek) => {
      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?week=${invalidWeek}`)
        .set("Authorization", AUTH_A);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 when requesting week 53 in a 52-week year (e.g. 2024-W53)", async () => {
      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?week=2024-W53`)
        .set("Authorization", AUTH_A);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 when unrecognized query parameter is supplied", async () => {
      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?unexpectedField=true`)
        .set("Authorization", AUTH_A);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });

  describe("Empty-Week Behavior", () => {
    it("returns 200 with zero metrics and supportive educational guidance when no records exist", async () => {
      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?week=2026-W45`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: "2026-W45",
        weekStartDate: "2026-11-02",
        weekEndDate: "2026-11-08",
        completedActivityCount: 0,
        observedMilestoneCount: 0,
        totalPlannedActivities: 0,
        domainDistribution: {
          cognitive: 0,
          motor: 0,
          language: 0,
          socioEmotional: 0
        },
        topActivityIds: [],
        reflectionPrompt:
          "Every week brings new moments to observe and share with your child. When you are ready, try exploring simple everyday activities together.",
        generatedAt: expect.any(String)
      });
    });
  });

  describe("Factual Aggregation & Traceability", () => {
    it("deterministically counts completed activities, planned activities, and milestone observations", async () => {
      // Create plans in target week: 2026-W45 (2026-11-02 to 2026-11-08)
      // Plan 1: completed, motor domain
      await plansStore.create("uid-a", childA.id, {
        id: "plan-1",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-001", // motor
        scheduledDate: "2026-11-03",
        status: "completed",
        createdAt: "2026-11-03T08:00:00Z",
        updatedAt: "2026-11-03T08:00:00Z"
      });

      // Plan 2: completed, cognitive domain
      await plansStore.create("uid-a", childA.id, {
        id: "plan-2",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-005", // cognitive
        scheduledDate: "2026-11-05",
        status: "completed",
        createdAt: "2026-11-05T08:00:00Z",
        updatedAt: "2026-11-05T08:00:00Z"
      });

      // Plan 3: planned status only (not completed)
      await plansStore.create("uid-a", childA.id, {
        id: "plan-3",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-002", // language
        scheduledDate: "2026-11-06",
        status: "planned",
        createdAt: "2026-11-06T08:00:00Z",
        updatedAt: "2026-11-06T08:00:00Z"
      });

      // Plan 4: skipped status
      await plansStore.create("uid-a", childA.id, {
        id: "plan-4",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-003",
        scheduledDate: "2026-11-07",
        status: "skipped",
        createdAt: "2026-11-07T08:00:00Z",
        updatedAt: "2026-11-07T08:00:00Z"
      });

      // Milestones:
      // Observation 1: observed status in week
      await milestonesStore.create("uid-a", childA.id, {
        id: "obs-1",
        childId: childA.id,
        caregiverId: "uid-a",
        milestoneId: "ms-mot-12-23m-01",
        status: "observed",
        observedDate: "2026-11-04",
        createdAt: "2026-11-04T08:00:00Z",
        updatedAt: "2026-11-04T08:00:00Z"
      });

      // Observation 2: observed status in week
      await milestonesStore.create("uid-a", childA.id, {
        id: "obs-2",
        childId: childA.id,
        caregiverId: "uid-a",
        milestoneId: "ms-lan-12-23m-01",
        status: "observed",
        observedDate: "2026-11-06",
        createdAt: "2026-11-06T08:00:00Z",
        updatedAt: "2026-11-06T08:00:00Z"
      });

      // Observation 3: not_yet_observed (should NOT count toward observedMilestoneCount)
      await milestonesStore.create("uid-a", childA.id, {
        id: "obs-3",
        childId: childA.id,
        caregiverId: "uid-a",
        milestoneId: "ms-cog-12-23m-01",
        status: "not_yet_observed",
        observedDate: "2026-11-07",
        createdAt: "2026-11-07T08:00:00Z",
        updatedAt: "2026-11-07T08:00:00Z"
      });

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?week=2026-W45`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.body.completedActivityCount).toBe(2);
      expect(res.body.totalPlannedActivities).toBe(4);
      expect(res.body.observedMilestoneCount).toBe(2);
      expect(res.body.domainDistribution).toEqual({
        motor: 1,
        cognitive: 1,
        language: 0,
        socioEmotional: 0
      });
      expect(res.body.topActivityIds).toEqual(
        expect.arrayContaining(["act-synth-001", "act-synth-005"])
      );
      expect(res.body.reflectionPrompt).toContain("shared activities and noted emerging milestones");
    });

    it("ranks topActivityIds by completion frequency up to maximum 3", async () => {
      // Complete act-synth-001 three times
      for (let i = 1; i <= 3; i++) {
        await plansStore.create("uid-a", childA.id, {
          id: `plan-mot-${i}`,
          childId: childA.id,
          caregiverId: "uid-a",
          activityId: "act-synth-001",
          scheduledDate: `2026-11-0${i + 1}`,
          status: "completed",
          createdAt: "2026-11-02T08:00:00Z",
          updatedAt: "2026-11-02T08:00:00Z"
        });
      }

      // Complete act-synth-002 twice
      for (let i = 1; i <= 2; i++) {
        await plansStore.create("uid-a", childA.id, {
          id: `plan-lan-${i}`,
          childId: childA.id,
          caregiverId: "uid-a",
          activityId: "act-synth-002",
          scheduledDate: `2026-11-0${i + 4}`,
          status: "completed",
          createdAt: "2026-11-02T08:00:00Z",
          updatedAt: "2026-11-02T08:00:00Z"
        });
      }

      // Complete act-synth-004 once
      await plansStore.create("uid-a", childA.id, {
        id: "plan-soc-1",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-004",
        scheduledDate: "2026-11-07",
        status: "completed",
        createdAt: "2026-11-02T08:00:00Z",
        updatedAt: "2026-11-02T08:00:00Z"
      });

      // Complete act-synth-005 once (4th distinct activity)
      await plansStore.create("uid-a", childA.id, {
        id: "plan-cog-1",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-005",
        scheduledDate: "2026-11-08",
        status: "completed",
        createdAt: "2026-11-02T08:00:00Z",
        updatedAt: "2026-11-02T08:00:00Z"
      });

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?week=2026-W45`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.body.topActivityIds).toHaveLength(3);
      expect(res.body.topActivityIds[0]).toBe("act-synth-001"); // 3 completions
      expect(res.body.topActivityIds[1]).toBe("act-synth-002"); // 2 completions
      // 3rd place is either act-synth-004 or act-synth-005 (tie-breaker by alphabetical id: act-synth-004)
      expect(res.body.topActivityIds[2]).toBe("act-synth-004");
    });
  });

  describe("Date Boundary Inclusivity", () => {
    it("includes Monday (start) and Sunday (end) but excludes dates outside the window", async () => {
      // Target week: 2026-W45 -> Monday 2026-11-02 through Sunday 2026-11-08

      // Plan before week: Sunday 2026-11-01 (EXCLUDED)
      await plansStore.create("uid-a", childA.id, {
        id: "plan-before",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-001",
        scheduledDate: "2026-11-01",
        status: "completed",
        createdAt: "2026-11-01T08:00:00Z",
        updatedAt: "2026-11-01T08:00:00Z"
      });

      // Plan on Monday: 2026-11-02 (INCLUDED)
      await plansStore.create("uid-a", childA.id, {
        id: "plan-start",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-001",
        scheduledDate: "2026-11-02",
        status: "completed",
        createdAt: "2026-11-02T08:00:00Z",
        updatedAt: "2026-11-02T08:00:00Z"
      });

      // Plan on Sunday: 2026-11-08 (INCLUDED)
      await plansStore.create("uid-a", childA.id, {
        id: "plan-end",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-001",
        scheduledDate: "2026-11-08",
        status: "completed",
        createdAt: "2026-11-08T08:00:00Z",
        updatedAt: "2026-11-08T08:00:00Z"
      });

      // Plan after week: Monday 2026-11-09 (EXCLUDED)
      await plansStore.create("uid-a", childA.id, {
        id: "plan-after",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-001",
        scheduledDate: "2026-11-09",
        status: "completed",
        createdAt: "2026-11-09T08:00:00Z",
        updatedAt: "2026-11-09T08:00:00Z"
      });

      // Same boundary checks for milestones
      await milestonesStore.create("uid-a", childA.id, {
        id: "obs-before",
        childId: childA.id,
        caregiverId: "uid-a",
        milestoneId: "ms-mot-01",
        status: "observed",
        observedDate: "2026-11-01",
        createdAt: "2026-11-01T08:00:00Z",
        updatedAt: "2026-11-01T08:00:00Z"
      });
      await milestonesStore.create("uid-a", childA.id, {
        id: "obs-start",
        childId: childA.id,
        caregiverId: "uid-a",
        milestoneId: "ms-mot-02",
        status: "observed",
        observedDate: "2026-11-02",
        createdAt: "2026-11-02T08:00:00Z",
        updatedAt: "2026-11-02T08:00:00Z"
      });
      await milestonesStore.create("uid-a", childA.id, {
        id: "obs-end",
        childId: childA.id,
        caregiverId: "uid-a",
        milestoneId: "ms-mot-03",
        status: "observed",
        observedDate: "2026-11-08",
        createdAt: "2026-11-08T08:00:00Z",
        updatedAt: "2026-11-08T08:00:00Z"
      });
      await milestonesStore.create("uid-a", childA.id, {
        id: "obs-after",
        childId: childA.id,
        caregiverId: "uid-a",
        milestoneId: "ms-mot-04",
        status: "observed",
        observedDate: "2026-11-09",
        createdAt: "2026-11-09T08:00:00Z",
        updatedAt: "2026-11-09T08:00:00Z"
      });

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?week=2026-W45`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.body.completedActivityCount).toBe(2); // plan-start and plan-end only
      expect(res.body.observedMilestoneCount).toBe(2); // obs-start and obs-end only
    });
  });

  describe("Default Week Behavior (?week omitted)", () => {
    it("defaults to the current ISO calendar week when ?week parameter is omitted", async () => {
      const now = new Date();
      const expectedWeek = currentIsoWeek(now);
      const expectedBounds = isoWeekBounds(expectedWeek);

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(expectedWeek);
      expect(res.body.weekStartDate).toBe(expectedBounds.weekStart);
      expect(res.body.weekEndDate).toBe(expectedBounds.weekEnd);
    });
  });

  describe("Non-Diagnostic Language Compliance (FR-05 & Ethics)", () => {
    it("strictly avoids clinical diagnosis, pass/fail labels, and delayed/abnormal claims", async () => {
      await plansStore.create("uid-a", childA.id, {
        id: "plan-1",
        childId: childA.id,
        caregiverId: "uid-a",
        activityId: "act-synth-001",
        scheduledDate: "2026-11-04",
        status: "completed",
        createdAt: "2026-11-04T08:00:00Z",
        updatedAt: "2026-11-04T08:00:00Z"
      });

      const res = await request(app)
        .get(`/api/v1/children/${childA.id}/summary/weekly?week=2026-W45`)
        .set("Authorization", AUTH_A);

      expect(res.status).toBe(200);
      const bodyText = JSON.stringify(res.body).toLowerCase();

      // Prohibited diagnostic terms
      const prohibitedTerms = [
        "delay",
        "delayed",
        "behind",
        "abnormal",
        "normal",
        "percentile",
        "clinical",
        "diagnosis",
        "diagnostic",
        "pass",
        "failed",
        "score",
        "deficit"
      ];

      for (const term of prohibitedTerms) {
        expect(bodyText).not.toContain(`"${term}"`);
        expect(bodyText).not.toContain(` ${term} `);
      }
    });
  });
});

