import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Issue #45: SERVE_SYNTHETIC_CATALOG flag tests
// ---------------------------------------------------------------------------
// These tests verify that the env flag correctly controls whether synthetic
// fixtures are loaded into the catalog store at module initialisation.
// Because the flag is evaluated at the top level of catalog-service.ts, we
// must re-import the module after setting the env var for each scenario.
// ---------------------------------------------------------------------------

describe("SERVE_SYNTHETIC_CATALOG env flag", { timeout: 15000 }, () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.SERVE_SYNTHETIC_CATALOG;
    vi.restoreAllMocks();
  });

  it("loads an empty catalog when the flag is unset (production default)", async () => {
    delete process.env.SERVE_SYNTHETIC_CATALOG;
    const { getCatalogActivities, getApprovedActivities } = await import(
      "../src/catalog/catalog-service.js"
    );

    const result = getCatalogActivities({});
    expect(result).toEqual({ total: 0, items: [] });
    expect(getApprovedActivities()).toEqual([]);
  });

  it('loads an empty catalog when the flag is "false"', async () => {
    process.env.SERVE_SYNTHETIC_CATALOG = "false";
    const { getCatalogActivities, getApprovedActivities } = await import(
      "../src/catalog/catalog-service.js"
    );

    const result = getCatalogActivities({});
    expect(result).toEqual({ total: 0, items: [] });
    expect(getApprovedActivities()).toEqual([]);
  });

  it('loads synthetic fixtures when the flag is "true"', async () => {
    process.env.SERVE_SYNTHETIC_CATALOG = "true";
    const { getCatalogActivities } = await import(
      "../src/catalog/catalog-service.js"
    );

    const result = getCatalogActivities({});
    expect(result.total).toBe(7);
    expect(result.items.length).toBe(7);

    // Every item must be synthetic_fixture — never reviewed_approved
    for (const item of result.items) {
      expect(item.status).toBe("synthetic_fixture");
      expect(item.provenanceSource).toBe(
        "Synthetic engineering fixture; no external source"
      );
    }
  });

  it("getApprovedActivities() returns [] even when flag is on (all fixtures are synthetic_fixture)", async () => {
    process.env.SERVE_SYNTHETIC_CATALOG = "true";
    const { getApprovedActivities } = await import(
      "../src/catalog/catalog-service.js"
    );

    // The AI helper only reads approved items — must remain empty
    expect(getApprovedActivities()).toEqual([]);
  });
});

