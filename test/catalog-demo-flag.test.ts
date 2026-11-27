import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import {
  getApprovedActivities,
  getCatalogActivities,
  getCatalogActivityById,
  setCatalogActivities,
  setCatalogStore,
  setMilestoneCatalogStore,
  setRhymeCatalogStore
} from "../src/catalog/catalog-service.js";
import {
  createInMemoryCatalogStore,
  createInMemoryMilestoneCatalogStore,
  createInMemoryRhymeCatalogStore
} from "../src/catalog/catalog-store.js";
import {
  CatalogActivitySchema,
  CatalogMilestoneSchema,
  CatalogRhymeSchema,
  type CatalogActivity
} from "../src/catalog/types.js";
import { SYNTHETIC_ACTIVITIES } from "./fixtures/catalog-activities.synthetic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = path.resolve(__dirname, "../seed/catalog-activities.json");
const milestonesSeedPath = path.resolve(__dirname, "../seed/catalog-milestones.json");
const rhymesSeedPath = path.resolve(__dirname, "../seed/catalog-rhymes.json");

describe("CatalogStore & Firestore seed validation", () => {
  afterEach(() => {
    setCatalogStore(createInMemoryCatalogStore([]));
    setMilestoneCatalogStore(createInMemoryMilestoneCatalogStore([]));
    setRhymeCatalogStore(createInMemoryRhymeCatalogStore([]));
  });

  it("starts empty when backed by an empty store", async () => {
    setCatalogStore(createInMemoryCatalogStore([]));
    expect(await getCatalogActivities({})).toEqual({ total: 0, items: [] });
    expect(await getApprovedActivities()).toEqual([]);
  });

  it("never returns synthetic_fixture items from getApprovedActivities()", async () => {
    setCatalogActivities(SYNTHETIC_ACTIVITIES);
    const catalog = await getCatalogActivities({});
    expect(catalog.total).toBe(SYNTHETIC_ACTIVITIES.length);
    expect(await getApprovedActivities()).toEqual([]);
  });

  it("returns source_checked and reviewed_approved items from getApprovedActivities()", async () => {
    const sample: CatalogActivity[] = [
      { ...SYNTHETIC_ACTIVITIES[0]!, id: "act-checked", status: "source_checked" },
      { ...SYNTHETIC_ACTIVITIES[1]!, id: "act-approved", status: "reviewed_approved" },
      { ...SYNTHETIC_ACTIVITIES[2]!, id: "act-draft", status: "draft" },
      { ...SYNTHETIC_ACTIVITIES[3]!, id: "act-synth", status: "synthetic_fixture" }
    ];
    setCatalogStore(createInMemoryCatalogStore(sample));

    const approved = await getApprovedActivities();
    expect(approved.map((a) => a.id)).toEqual(["act-checked", "act-approved"]);
    expect((await getCatalogActivityById("act-checked"))?.title).toBe(SYNTHETIC_ACTIVITIES[0]!.title);
  });

  it("validates every item in seed/catalog-activities.json against CatalogActivitySchema", () => {
    const raw = JSON.parse(fs.readFileSync(seedPath, "utf8")) as unknown[];
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBeGreaterThanOrEqual(21);

    const parsed = raw.map((item) => CatalogActivitySchema.parse(item));
    const ids = new Set(parsed.map((item) => item.id));
    expect(ids.size).toBe(parsed.length);

    for (const item of parsed) {
      expect(item.status).toBe("source_checked");
      expect(item.provenanceSource.length).toBeGreaterThan(10);
    }

    // Every age band should have at least 3 activities for balanced Explore & AI picks.
    const bands = ["0-5m", "6-11m", "12-23m", "24-35m", "36-47m", "48-59m", "60-71m"];
    for (const band of bands) {
      const count = parsed.filter((item) => item.ageBand === band).length;
      expect(count).toBeGreaterThanOrEqual(3);
    }
  });

  it("validates every item in seed/catalog-milestones.json and serves GET /api/v1/catalog/milestones", async () => {
    const raw = JSON.parse(fs.readFileSync(milestonesSeedPath, "utf8")) as unknown[];
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBe(25);

    const parsed = raw.map((item) => CatalogMilestoneSchema.parse(item));
    const ids = new Set(parsed.map((item) => item.id));
    expect(ids.size).toBe(parsed.length);

    const bands = [
      "0-11 months",
      "12-23 months",
      "24-35 months",
      "36-47 months",
      "48-59 months",
      "60-71 months"
    ];
    for (const band of bands) {
      expect(parsed.filter((item) => item.ageBand === band).length).toBeGreaterThanOrEqual(4);
    }

    setMilestoneCatalogStore(createInMemoryMilestoneCatalogStore(parsed));

    const allRes = await request(app).get("/api/v1/catalog/milestones");
    expect(allRes.status).toBe(200);
    expect(allRes.headers["cache-control"]).toBe("public, max-age=3600");
    expect(allRes.body.total).toBe(25);
    expect(allRes.body.items).toHaveLength(25);

    const filteredRes = await request(app).get("/api/v1/catalog/milestones?ageBand=60-71%20months&domain=language");
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.total).toBeGreaterThanOrEqual(1);
    for (const item of filteredRes.body.items) {
      expect(item.ageBand).toBe("60-71 months");
      expect(item.domain).toBe("language");
    }

    const badRes = await request(app).get("/api/v1/catalog/milestones?domain=invalid");
    expect(badRes.status).toBe(400);
    expect(badRes.body.error.code).toBe("INVALID_INPUT");
  });

  it("validates every item in seed/catalog-rhymes.json and serves GET /api/v1/catalog/rhymes", async () => {
    const raw = JSON.parse(fs.readFileSync(rhymesSeedPath, "utf8")) as unknown[];
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.length).toBe(6);

    const parsed = raw.map((item) => CatalogRhymeSchema.parse(item));
    const ids = new Set(parsed.map((item) => item.id));
    expect(ids.size).toBe(parsed.length);
    expect(parsed.some((item) => item.language === "hil")).toBe(true);

    setRhymeCatalogStore(createInMemoryRhymeCatalogStore(parsed));

    const allRes = await request(app).get("/api/v1/catalog/rhymes");
    expect(allRes.status).toBe(200);
    expect(allRes.headers["cache-control"]).toBe("public, max-age=3600");
    expect(allRes.body.total).toBe(6);
    expect(allRes.body.items).toHaveLength(6);

    const hilRes = await request(app).get("/api/v1/catalog/rhymes?language=hil");
    expect(hilRes.status).toBe(200);
    expect(hilRes.body.total).toBe(1);
    expect(hilRes.body.items[0].id).toBe("rhyme-ili-ili-tulog-anay");

    const badRes = await request(app).get("/api/v1/catalog/rhymes?language=xx");
    expect(badRes.status).toBe(400);
    expect(badRes.body.error.code).toBe("INVALID_INPUT");
  });
});
