import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recommend } from "../../src/ai/ai-service.js";
import { FakeProvider } from "../../src/ai/providers/fake.js";
import { resolveResponseSchema, CUSTOM_PLAY_RESPONSE_SCHEMA } from "../../src/ai/providers/gemini.js";
import {
  setApprovedActivitiesForTest,
  setCatalogActivities
} from "../../src/catalog/catalog-service.js";
import { approved } from "./helpers.js";

describe("Hybrid AI Recommendations (Catalog-First + Guardrailed ai_custom)", () => {
  const catalog = [
    approved({
      id: "act-cups",
      ageBand: "12-23m",
      title: "Stack the Plastic Cups",
      domain: "cognitive",
      setting: "indoor",
      materials: ["plastic cups"]
    }),
    approved({
      id: "act-cushions",
      ageBand: "12-23m",
      title: "Cushion Mountain Crawl",
      domain: "motor",
      setting: "indoor",
      materials: ["couch cushions", "pillows"]
    })
  ];

  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    setApprovedActivitiesForTest(catalog);
  });

  afterEach(() => {
    setCatalogActivities([]);
    vi.restoreAllMocks();
  });

  it("evaluates banana and shampoo via layered guardrails and generates a custom banana activity", async () => {
    let capturedPrompt = "";
    const provider = new FakeProvider((prompt) => {
      capturedPrompt = prompt;
      return {
        materialAssessments: [
          { input: "banana", normalizedItem: "banana", isSafe: true },
          { input: "shampoo", normalizedItem: "shampoo", isSafe: false, reason: "soap ingestion hazard" }
        ],
        suggestions: [
          {
            title: "Banana Peel and Squish Play",
            domain: "motor",
            durationMinutes: 10,
            setting: "indoor",
            usedMaterials: ["banana"],
            instructions: [
              "Peel a ripe banana together and let your toddler feel the soft fruit.",
              "Place slices on a clean plate to squish and scoop with fingers."
            ],
            safetyNotice: "Stay close and slice banana into soft bite-sized pieces.",
            whyPicked: "Uses your banana for gentle supervised indoor sensory play."
          }
        ],
        materialNote: "Using banana; skipping shampoo."
      };
    });

    const res = await recommend(
      {
        ageBand: "12-23m",
        setting: "indoor",
        timeMinutes: 15,
        materials: ["banana", "shampoo"],
        language: "en",
        count: 3,
        allowCustom: true
      },
      provider
    );

    expect(resolveResponseSchema(capturedPrompt)).toBe(CUSTOM_PLAY_RESPONSE_SCHEMA);
    expect(capturedPrompt).toContain('"caregiverMaterials":["banana","shampoo"]');

    expect(res.source).toBe("ai_custom");
    expect(res.tier).toBe(1);
    expect(res.provenance.badge).toBe("Suggested by AI");
    expect(res.provenance.label).toBe("Material adaptation");
    expect(res.provenance.reviewed).toBe(false);
    expect(res.materialNote).toBe(
      "Using banana for safe supervised play; skipped shampoo because it isn't safe for young children to handle or mouth."
    );
    expect(res.suggestions).toHaveLength(1);
    expect(res.suggestions[0].isCustom).toBe(true);
    expect(res.suggestions[0].activity.provenanceSource).toBe("");
    expect(res.suggestions[0].title).toBe("Banana Peel and Squish Play");
  });

  it("keeps catalog-first Tier 1 matching when materials overlap a reviewed activity", async () => {
    const provider = FakeProvider.valid([{ id: "act-cups", why: "Great for stacking with your plastic cups." }]);

    const res = await recommend(
      {
        ageBand: "12-23m",
        setting: "indoor",
        timeMinutes: 15,
        materials: ["cups"],
        language: "en",
        count: 3,
        allowCustom: true
      },
      provider
    );

    expect(res.source).toBe("ai");
    expect(res.provenance.reviewed).toBe(true);
    expect(res.suggestions[0].activityId).toBe("act-cups");
    expect(res.suggestions[0].isCustom).toBeUndefined();
  });

  it("skips custom generation and falls back to reviewed catalog when all materials are unsafe", async () => {
    const provider = FakeProvider.throws();

    const res = await recommend(
      {
        ageBand: "12-23m",
        setting: "indoor",
        timeMinutes: 15,
        materials: ["bleach", "sharp knife"],
        language: "en",
        count: 3,
        allowCustom: true
      },
      provider
    );

    expect(provider.calls).toBe(0);
    expect(res.source).toBe("catalog_fallback");
    expect(res.tier).toBe(3);
    expect(res.provenance.reviewed).toBe(true);
    expect(res.materialNote).toContain("bleach");
    expect(res.suggestions.length).toBeGreaterThan(0);
  });

  it("fails closed to catalog fallback if custom reply sneaks in a hazardous item or diagnostic word", async () => {
    const unsafeProvider = new FakeProvider(() => ({
      suggestions: [
        {
          title: "Bubble Mix",
          domain: "motor",
          durationMinutes: 10,
          setting: "indoor",
          usedMaterials: ["banana", "shampoo"],
          instructions: ["Mix banana and shampoo in a bowl.", "Let toddler touch it."],
          safetyNotice: "Supervise closely.",
          whyPicked: "Checks for motor delay."
        }
      ]
    }));

    const res = await recommend(
      {
        ageBand: "12-23m",
        setting: "indoor",
        timeMinutes: 15,
        materials: ["banana", "shampoo"],
        language: "en",
        count: 3,
        allowCustom: true
      },
      unsafeProvider
    );

    expect(res.source).toBe("catalog_fallback");
    expect(res.tier).toBe(3);
    expect(res.provenance.reviewed).toBe(true);
  });

  it("lets typos and Filipino/Hiligaynon terms reach Gemini for structured assessment, pluralizes skip reason, and derives Using list from actual card materials", async () => {
    let seenPrompt = "";
    const provider = new FakeProvider((prompt) => {
      seenPrompt = prompt;
      return {
        materialAssessments: [
          { input: "banana", normalizedItem: "banana", isSafe: true },
          { input: "shampo", normalizedItem: "shampoo", isSafe: false, reason: "liquid soap hazard" },
          { input: "sabon", normalizedItem: "soap", isSafe: false, reason: "ingestion hazard" },
          { input: "cellphone", normalizedItem: "cellphone", isSafe: false, reason: "screen and fragile device" },
          { input: "cap", normalizedItem: "bottle cap", isSafe: false, reason: "choking hazard for 0-35m" },
          { input: "orange", normalizedItem: "orange", isSafe: true },
          { input: "towel", normalizedItem: "towel", isSafe: true }
        ],
        suggestions: [
          {
            title: "Fruit Roll and Name",
            domain: "cognitive",
            durationMinutes: 10,
            setting: "indoor",
            usedMaterials: ["banana", "orange"],
            instructions: [
              "Place a whole banana and orange on a soft mat.",
              "Name each fruit color and roll it gently back and forth."
            ],
            safetyNotice: "Keep adult supervision at all times.",
            whyPicked: "Uses your banana and orange for gentle indoor play."
          }
        ]
      };
    });

    const res = await recommend(
      {
        ageBand: "12-23m",
        setting: "indoor",
        timeMinutes: 30,
        materials: ["banana", "shampo", "sabon", "cellphone", "cap", "orange", "towel", "bleach"],
        language: "en",
        count: 3,
        allowCustom: true
      },
      provider
    );

    // Layer 1 blocked extreme danger "bleach" before calling Gemini, while passing typos & regional terms through.
    expect(seenPrompt).toContain('"skippedUnsafeMaterials":["bleach"]');
    expect(seenPrompt).toContain('"shampo"');
    expect(seenPrompt).toContain('"sabon"');

    expect(res.source).toBe("ai_custom");
    expect(res.materialNote).toBe(
      "Using banana, orange for safe supervised play; skipped bleach, shampoo, soap, cellphone, bottle cap because they aren't safe for young children to handle or mouth."
    );
    expect(res.materialNote).not.toContain("towel");
  });

  it("Layer 3 fails closed if Gemini normalizes a typo to shampoo or bottle cap but still marks it safe", async () => {
    const leakyProvider = new FakeProvider(() => ({
      materialAssessments: [
        { input: "shampo", normalizedItem: "shampoo", isSafe: true },
        { input: "banana", normalizedItem: "banana", isSafe: true }
      ],
      suggestions: [
        {
          title: "Banana Sensory Play",
          domain: "cognitive",
          durationMinutes: 10,
          setting: "indoor",
          usedMaterials: ["banana"],
          instructions: ["Place the banana on a clean mat.", "Let your toddler touch it."],
          safetyNotice: "Supervise closely.",
          whyPicked: "Gentle indoor play."
        }
      ]
    }));

    const res = await recommend(
      {
        ageBand: "12-23m",
        setting: "indoor",
        timeMinutes: 15,
        materials: ["banana", "shampo"],
        language: "en",
        count: 3,
        allowCustom: true
      },
      leakyProvider
    );

    expect(res.source).toBe("catalog_fallback");
    expect(res.tier).toBe(3);
    expect(res.provenance.reviewed).toBe(true);
  });

  it("falls back cleanly to reviewed catalog with safety note when Gemini marks all items unsafe", async () => {
    const provider = new FakeProvider(() => ({
      materialAssessments: [
        { input: "shampo", normalizedItem: "shampoo", isSafe: false, reason: "liquid soap" },
        { input: "cap", normalizedItem: "bottle cap", isSafe: false, reason: "choking hazard" }
      ],
      suggestions: []
    }));

    const res = await recommend(
      {
        ageBand: "12-23m",
        setting: "indoor",
        timeMinutes: 15,
        materials: ["shampo", "cap"],
        language: "en",
        count: 3,
        allowCustom: true
      },
      provider
    );

    expect(res.source).toBe("catalog_fallback");
    expect(res.tier).toBe(3);
    expect(res.provenance.reviewed).toBe(true);
    expect(res.materialNote).toBe(
      "Skipped shampoo, bottle cap because they aren't safe for young children to handle or mouth. Here are reviewed play ideas for this age instead."
    );
    expect(res.suggestions.length).toBeGreaterThan(0);
  });
});
