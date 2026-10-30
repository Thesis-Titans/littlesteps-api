import type { CatalogActivity } from "../../src/catalog/types.js";

export function approved(overrides: Partial<CatalogActivity> & { id: string }): CatalogActivity {
  return {
    title: `Title ${overrides.id}`,
    type: "activity",
    language: "en",
    setting: "indoor",
    ageBand: "12-23m",
    domain: "cognitive",
    durationMinutes: 10,
    durationEstimate: "10 mins",
    materials: ["blocks"],
    instructions: ["Play together."],
    provenanceSource: "Test source",
    status: "reviewed_approved",
    limitations: "Test only.",
    ...overrides
  };
}

export const baseRequest = {
  ageBand: "12-23m",
  timeMinutes: 30,
  language: "en"
} as const;
