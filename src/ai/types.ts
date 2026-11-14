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

export const ChatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    ageBand: AgeBandSchema,
    childNickname: z.string().trim().max(50).optional()
  })
  .strict();
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export interface ChatActivitySuggestion {
  title: string;
  domain: string;
  durationMinutes: number;
  instructions: string;
  materials: string[];
  safetyNotice: string;
}

export interface ChatResponse {
  reply: string;
  suggestedActivity: ChatActivitySuggestion | null;
  provenance: {
    tier: 1 | 2 | 3;
    source: string;
    badge: "Suggested by AI" | null;
    disclaimer: string;
  };
}

export const DISCLAIMER = "Observational play suggestion only. Not developmental assessment.";
export const GUIDANCE = "You know your child best. Change it as you like, and stay close while you play.";
