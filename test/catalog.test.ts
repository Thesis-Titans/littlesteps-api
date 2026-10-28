import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { clearBooksCache } from "../src/catalog/catalog-service.js";

describe("Learning Catalog API (/api/v1/catalog)", () => {
  beforeEach(() => {
    clearBooksCache();
  });

  describe("GET /api/v1/catalog/activities", () => {
    it("returns public activities with cache-control header", async () => {
      const res = await request(app).get("/api/v1/catalog/activities");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
      expect(res.body).toHaveProperty("total");
      expect(res.body).toHaveProperty("items");
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.items.length).toBeGreaterThan(0);
    });

    it("verifies item schema and provenance attribution constraints", async () => {
      const res = await request(app).get("/api/v1/catalog/activities");
      expect(res.status).toBe(200);

      for (const item of res.body.items) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("type");
        expect(item).toHaveProperty("language");
        expect(item).toHaveProperty("setting");
        expect(item).toHaveProperty("ageBand");
        expect(item).toHaveProperty("domain");
        expect(item).toHaveProperty("durationMinutes");
        expect(item).toHaveProperty("durationEstimate");
        expect(item).toHaveProperty("materials");
        expect(item).toHaveProperty("instructions");
        expect(item).toHaveProperty("provenanceSource");
        expect(item).toHaveProperty("status");
        expect(item).toHaveProperty("limitations");

        // Criterion: Draft/unreviewed content cannot be represented as approved
        expect(["reviewed_approved", "synthetic_fixture"]).toContain(item.status);
        if (item.status === "synthetic_fixture") {
          expect(item.limitations).toContain("Pending Review");
        }
      }
    });

    it("filters activities by ageBand", async () => {
      const res = await request(app).get("/api/v1/catalog/activities?ageBand=0-5m");
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.ageBand).toBe("0-5m");
      }
    });

    it("filters activities by type", async () => {
      const res = await request(app).get("/api/v1/catalog/activities?type=rhyme");
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      for (const item of res.body.items) {
        expect(item.type).toBe("rhyme");
      }
    });

    it("returns empty result array when no items match filters", async () => {
      // 0-5m infants do not have outdoor hopscotch games
      const res = await request(app).get("/api/v1/catalog/activities?ageBand=0-5m&type=game&setting=outdoor");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
      expect(res.body.items).toEqual([]);
    });

    it("enforces pagination limit", async () => {
      const res = await request(app).get("/api/v1/catalog/activities?limit=2");
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
    });

    it("returns 400 INVALID_INPUT on invalid ageBand filter", async () => {
      const res = await request(app).get("/api/v1/catalog/activities?ageBand=invalid-band");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
      expect(res.body.error).toHaveProperty("details");
    });

    it("returns 400 INVALID_INPUT on invalid limit", async () => {
      const res = await request(app).get("/api/v1/catalog/activities?limit=999");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });

  describe("GET /api/v1/catalog/activities/:id", () => {
    it("returns a specific activity by id", async () => {
      const res = await request(app).get("/api/v1/catalog/activities/act-synth-001");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("act-synth-001");
      expect(res.body.title).toBe("Tummy Time Mirror Play");
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    });

    it("returns 404 NOT_FOUND for unknown activity id", async () => {
      const res = await request(app).get("/api/v1/catalog/activities/non-existent-id");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /api/v1/catalog/books", () => {
    it("returns picture books with provenance and caching headers", async () => {
      const res = await request(app).get("/api/v1/catalog/books?subject=picture_books&limit=3");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
      expect(res.body).toHaveProperty("subject", "picture_books");
      expect(res.body).toHaveProperty("books");
      expect(Array.isArray(res.body.books)).toBe(true);
      expect(res.body).toHaveProperty("provenance");
      expect(res.body.provenance).toHaveProperty("source");
    });

    it("demonstrates 1-hour cache hit on subsequent request", async () => {
      // First request (MISS or fallback)
      const res1 = await request(app).get("/api/v1/catalog/books?subject=bedtime&limit=2");
      expect(res1.status).toBe(200);

      // If res1 succeeded from Open Library or was stored in cache:
      // Second request must be serviced from cache with near-zero latency
      const start = Date.now();
      const res2 = await request(app).get("/api/v1/catalog/books?subject=bedtime&limit=2");
      const elapsed = Date.now() - start;

      expect(res2.status).toBe(200);
      // Cache response should take under 50ms locally
      expect(elapsed).toBeLessThan(150);
    });

    it("returns 400 INVALID_INPUT on invalid limit", async () => {
      const res = await request(app).get("/api/v1/catalog/books?limit=100");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });
});
