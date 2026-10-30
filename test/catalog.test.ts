import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { SYNTHETIC_ACTIVITIES } from "./fixtures/catalog-activities.synthetic.js";
import { buildUserAgent, clearBooksCache, setCatalogActivities } from "../src/catalog/catalog-service.js";

// ---------------------------------------------------------------------------
// Helpers – deterministic mock fetch responses for Open Library
// ---------------------------------------------------------------------------

const MOCK_OPEN_LIBRARY_RESPONSE = {
  work_count: 2,
  works: [
    {
      key: "/works/OL52987W",
      title: "The Very Hungry Caterpillar",
      authors: [{ name: "Eric Carle" }],
      cover_id: 7835968,
      subject: ["Caterpillars", "Picture books"]
    },
    {
      key: "/works/OL151798W",
      title: "Goodnight Moon",
      authors: [{ name: "Margaret Wise Brown" }],
      cover_id: 35556,
      subject: ["Bedtime"]
    }
  ]
};

function makeFetchOk(body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body)
  } as unknown as Response);
}

function makeFetchFail(): typeof fetch {
  return vi.fn().mockRejectedValue(new Error("Network error (simulated for offline test)"));
}

// ---------------------------------------------------------------------------

describe("Learning Catalog API (/api/v1/catalog)", () => {
  beforeEach(() => {
    setCatalogActivities(SYNTHETIC_ACTIVITIES);
    clearBooksCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Activities
  // -------------------------------------------------------------------------

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

        // Fix #1 enforcement: synthetic fixtures must never appear as approved
        expect(item.status).toBe("synthetic_fixture");
        expect(item.limitations).toContain("Pending Review");
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
      expect(res.body.error.details[0]).toEqual({ field: expect.any(String), issue: expect.any(String) });
    });

    it("returns 400 INVALID_INPUT on invalid limit", async () => {
      const res = await request(app).get("/api/v1/catalog/activities?limit=999");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });

  // -------------------------------------------------------------------------
  // Single activity
  // -------------------------------------------------------------------------

  describe("GET /api/v1/catalog/activities/:id", () => {
    it("returns a specific activity by id", async () => {
      const res = await request(app).get("/api/v1/catalog/activities/act-synth-001");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("act-synth-001");
      expect(res.body.title).toBe("Tummy Time Mirror Play");
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    });

    it("returns 404 RESOURCE_NOT_FOUND with a fixed message for unknown id", async () => {
      const res = await request(app).get("/api/v1/catalog/activities/non-existent-id");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("RESOURCE_NOT_FOUND");
      expect(res.body.error.message).not.toContain("non-existent-id");
    });

    it("returns 400 INVALID_INPUT for malformed or oversized id", async () => {
      for (const id of ["BAD_ID", "a".repeat(65)]) {
        const res = await request(app).get(`/api/v1/catalog/activities/${id}`);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe("INVALID_INPUT");
      }
    });

    it("rejects reviewed_approved fixtures at injection", () => {
      expect(() => setCatalogActivities([{ ...SYNTHETIC_ACTIVITIES[0]!, status: "reviewed_approved" }])).toThrow(/Content gating/);
    });
  });

  // -------------------------------------------------------------------------
  // Books – Fix #4: all network interactions are now mocked deterministically.
  // -------------------------------------------------------------------------

  describe("GET /api/v1/catalog/books", () => {
    it("returns picture books with provenance and licence text from Open Library", async () => {
      vi.stubGlobal("fetch", makeFetchOk(MOCK_OPEN_LIBRARY_RESPONSE));

      const res = await request(app).get("/api/v1/catalog/books?subject=picture_books&limit=2");
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=3600");
      expect(res.body).toHaveProperty("subject", "picture_books");
      expect(Array.isArray(res.body.books)).toBe(true);
      expect(res.body.books).toHaveLength(2);
      expect(res.body.books[0].id).toBe("OL52987W");
      // Fix #2: license must use the Open Library licence text
      expect(res.body.provenance.license).toBe("Open Library data; no new rights asserted by the Internet Archive (see https://openlibrary.org/developers/licensing); cover images may carry their own rights");
    });

    it("serves a cache HIT on subsequent identical request without calling fetch again", async () => {
      const mockFetch = makeFetchOk(MOCK_OPEN_LIBRARY_RESPONSE);
      vi.stubGlobal("fetch", mockFetch);

      // First request — cache MISS, calls fetch once
      await request(app).get("/api/v1/catalog/books?subject=picture_books&limit=2");

      // Second request — must come from cache, fetch should NOT be called again
      const res2 = await request(app).get("/api/v1/catalog/books?subject=picture_books&limit=2");
      expect(res2.status).toBe(200);
      expect(res2.headers["x-cache"]).toBe("HIT");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("falls back to local fixture when Open Library is unavailable (simulated network error)", async () => {
      vi.stubGlobal("fetch", makeFetchFail());

      const res = await request(app).get("/api/v1/catalog/books?subject=picture_books&limit=3");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.books)).toBe(true);
      // Fallback serves local curated books with the Open Library licence text
      expect(res.body.provenance.source).toBe("local-fallback");
      expect(res.body.provenance.license).toBe("Open Library data; no new rights asserted by the Internet Archive (see https://openlibrary.org/developers/licensing); cover images may carry their own rights");
    });

    it("falls back to local fixture when Open Library returns a 500 error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({})
      } as unknown as Response));

      const res = await request(app).get("/api/v1/catalog/books?subject=picture_books&limit=3");
      expect(res.status).toBe(200);
      expect(res.body.provenance.source).toBe("local-fallback");
      expect(res.headers["cache-control"]).toBe("public, max-age=60");
    });

    it("caches the fallback so a second request does not hit upstream", async () => {
      const mockFetch = makeFetchFail();
      vi.stubGlobal("fetch", mockFetch);
      await request(app).get("/api/v1/catalog/books?limit=3");
      const res = await request(app).get("/api/v1/catalog/books?limit=3");
      expect(res.headers["x-cache"]).toBe("HIT");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns 400 INVALID_INPUT for a subject outside the allowlist", async () => {
      const res = await request(app).get("/api/v1/catalog/books?subject=horror");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 INVALID_INPUT on invalid limit", async () => {
      const res = await request(app).get("/api/v1/catalog/books?limit=100");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });

    it("returns 400 INVALID_INPUT when subject exceeds 64 characters", async () => {
      const longSubject = "a".repeat(65);
      const res = await request(app).get(`/api/v1/catalog/books?subject=${longSubject}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_INPUT");
    });
  });
});

describe("Open Library User-Agent", () => {
  it("adds a clean contact", () => {
    expect(buildUserAgent("team@example.org")).toBe(
      "LittleSteps-API/0.2.0 (Thesis Academic Project; contact: team@example.org)"
    );
  });

  it("drops control and non-ASCII characters and falls back when empty", () => {
    expect(buildUserAgent("a@b.org\r\nX-Evil: 1")).not.toMatch(/[\r\n]/);
    expect(buildUserAgent("\r\n")).toBe("LittleSteps-API/0.2.0 (Thesis Academic Project)");
    expect(buildUserAgent(undefined)).toBe("LittleSteps-API/0.2.0 (Thesis Academic Project)");
  });
});
