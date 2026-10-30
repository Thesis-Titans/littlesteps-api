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
  count: z.number().int().min(1).max(3).default(3)
});
export type RecommendationRequest = z.infer<typeof RecommendationRequestSchema>;

export interface Suggestion {
  activityId: string;
  title: string;
  whyPicked: string;
  activity: CatalogActivity;
}

export interface Provenance {
  badge: "Suggested by AI" | null;
  label: "Our picks" | null;
  disclaimer: string;
  guidance?: string;
  model: string | null;
  reviewed: true;
}

export interface RecommendationResponse {
  suggestions: Suggestion[];
  source: "ai" | "catalog_fallback";
  tier: 1 | 2 | 3;
  provenance: Provenance;
  reason?: "NO_REVIEWED_CONTENT";
}

export const DISCLAIMER = "Observational play suggestion only. Not developmental assessment.";
export const GUIDANCE = "You know your child best. Change it as you like, and stay close while you play.";
