import { z } from "zod";
import {
  AgeBandSchema,
  DomainSchema,
  LanguageSchema,
  SettingSchema,
  type CatalogActivity
} from "../catalog/types.js";

// Strict on purpose: identifying fields (childId, nickname, notes...) are rejected, never ignored.
export const RecommendationRequestSchema = z.strictObject({
  ageBand: AgeBandSchema,
  domain: DomainSchema.optional(),
  setting: SettingSchema.default("either"),
  timeMinutes: z.number().int().min(5).max(120),
  materials: z.array(z.string().max(40)).max(10).default([]),
  language: LanguageSchema,
  count: z.number().int().min(1).max(3).default(3),
  allowCustom: z.boolean().default(false)
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

export interface Suggestion {
  activityId: string;
  title: string;
  whyPicked: string;
  activity: CatalogActivity;
  isCustom?: boolean;
}

export interface Provenance {
  badge: "Suggested by AI" | null;
  label: "Our picks" | "Material adaptation" | null;
  disclaimer: string;
  guidance?: string;
  model: string | null;
  reviewed: boolean;
}

export interface RecommendationResponse {
  suggestions: Suggestion[];
  source: "ai" | "ai_custom" | "catalog_fallback";
  tier: 1 | 2 | 3;
  provenance: Provenance;
  reason?: "NO_REVIEWED_CONTENT";
  materialNote?: string;
}

// Strict schema for story companion activity requests
export const StoryActivityRequestSchema = z
  .object({
    bookTitle: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    subjects: z.array(z.string().trim().max(64)).max(10).default([]),
    ageBand: AgeBandSchema
  })
  .strict()
  .refine((data) => Boolean(data.bookTitle || data.title), {
    message: "Either bookTitle or title must be provided",
    path: ["bookTitle"]
  });
export type StoryActivityRequest = z.infer<typeof StoryActivityRequestSchema>;

export interface StoryActivitySuggestion {
  title: string;
  domain: string;
  instructions: string;
  safetyNotice: string;
}

export interface StoryActivityProvenance {
  tier: 1 | 2 | 3;
  source: string;
  badge: "Suggested by AI" | null;
  disclaimer: string;
}

export interface StoryActivityResponse {
  bookTitle: string;
  suggestion: StoryActivitySuggestion;
  provenance: StoryActivityProvenance;
}

export const DISCLAIMER = "Observational play suggestion only. Not developmental assessment.";
export const GUIDANCE = "You know your child best. Change it as you like, and stay close while you play.";

// Activity Adaptation (Issue #61, ADR-012)
export const ActivityAdjustmentSchema = z.enum(["shorter", "easier", "harder", "missing_material"]);
export type ActivityAdjustment = z.infer<typeof ActivityAdjustmentSchema>;

export const AdaptActivityRequestSchema = z.strictObject({
  activityId: z.string().trim().min(1).max(100),
  adjustment: ActivityAdjustmentSchema,
  missingMaterial: z.string().trim().max(60).optional(),
  ageBand: AgeBandSchema.optional()
});
export type AdaptActivityRequest = z.infer<typeof AdaptActivityRequestSchema>;

export interface AdaptedActivitySuggestion {
  activityId: string;
  originalTitle: string;
  adaptedTitle: string;
  adjustment: ActivityAdjustment;
  instructions: string[];
  materials: string[];
  safetyNotice: string;
  explanation: string;
}

export interface AdaptActivityResponse {
  adapted: AdaptedActivitySuggestion;
  source: "ai" | "fallback";
  tier: 1 | 2;
  provenance: {
    badge: "Suggested by AI" | null;
    disclaimer: string;
    model: string | null;
  };
}
