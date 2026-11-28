import { z } from "zod";
import type { AgeBand } from "../catalog/types.js";
import { containsHazardousMaterial } from "./sanitize.js";

// Non-diagnostic wording rule: docs/ui-ux-design-specification.md section 8 and
// security-privacy-ai.md NFR-AI-04. Text is normalised first (Unicode, lookalikes, case); fail closed on any match.
export const NON_DIAGNOSTIC_DENYLIST: readonly string[] = [
  "delay", "disorder", "diagnos", "autis", "adhd", "assessment", "assessing", "assessed", "treatment",
  "treating", "therapy", "therapist", "clinical", "abnormal", "falling behind", "behind in",
  "developmentally delayed", "developmental concern", "developmental problem", "developmental issue",
  "deficit", "screening score", "red flag", "impair", "disabilit", "syndrome", "milestone",
  // Filipino and Hiligaynon non-diagnostic terms. Needs ongoing native-speaker review as coverage expands.
  "antala", "naantala", "nagkaantala", "pagkaantala", "kapansanan", "sakit sa pag-iisip",
  "naulihi", "pagkaulihi", "balatian sa paminsaron", "depekto"
];

// Common Cyrillic/Greek lookalikes folded to Latin. shortcut: small explicit map, extend if new ones show up.
const LOOKALIKES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "у": "y",
  "ԁ": "d", "ɡ": "g", "ο": "o", "ν": "v", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ρ": "p", "τ": "t", "υ": "u", "χ": "x"
};

function normalise(text: string): string {
  return text
    .normalize("NFKC")
    // Accents are removed for matching only; the stored text is untouched.
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .toLowerCase()
    .replace(/\P{ASCII}/gu, (ch) => LOOKALIKES[ch] ?? ch)
    .replace(/ +/g, " ")
    .trim();
}

const denylistPattern = new RegExp(
  `\\b(?:${NON_DIAGNOSTIC_DENYLIST.map((t) => t.replace(/ /g, "\\s+")).join("|")})`
);

function hitsDenylist(text: string): boolean {
  const base = normalise(text);
  // Second variant: punctuation between letters removed, so "de-lay" and "de_lay" still match.
  const joined = base.replace(/(?<=\p{L})[\p{P}\p{S}]+(?=\p{L})/gu, "");
  return denylistPattern.test(base) || denylistPattern.test(joined);
}

export const MAX_WHY_LENGTH = 140;

const ReplySchema = z.object({
  picks: z.array(z.object({ id: z.string(), why: z.string().trim().min(1).max(MAX_WHY_LENGTH)
      .refine((w) => !/[<>]|https?:\/\/|www\./i.test(w)) })).min(1)
});

export interface Pick {
  id: string;
  why: string;
}

const StoryReplySchema = z.object({
  title: z.string().trim().min(1).max(60).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w)),
  domain: z.enum(["cognitive", "motor", "language", "socioEmotional"]),
  instructions: z.string().trim().min(1).max(300).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w)),
  safetyNotice: z.string().trim().min(1).max(140).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w))
});

export interface StoryPick {
  title: string;
  domain: "cognitive" | "motor" | "language" | "socioEmotional";
  instructions: string;
  safetyNotice: string;
}

/** Validates LLM story companion play suggestion; returns null if any validation check fails or denylist is hit. */
export function validateStoryOutput(reply: unknown): StoryPick | null {
  const parsed = StoryReplySchema.safeParse(reply);
  if (!parsed.success) return null;
  const { title, domain, instructions, safetyNotice } = parsed.data;
  if (hitsDenylist(title) || hitsDenylist(instructions) || hitsDenylist(safetyNotice)) {
    return null;
  }
  return { title, domain, instructions, safetyNotice };
}

const AdaptReplySchema = z.object({
  adaptedTitle: z.string().trim().min(1).max(60).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w)),
  instructions: z.array(z.string().trim().min(1).max(200).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w))).min(1).max(5),
  materials: z.array(z.string().trim().min(1).max(60).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w))).max(10),
  safetyNotice: z.string().trim().min(1).max(140).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w)),
  explanation: z.string().trim().min(1).max(200).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w))
});

export interface AdaptPick {
  adaptedTitle: string;
  instructions: string[];
  materials: string[];
  safetyNotice: string;
  explanation: string;
}

/** Validates LLM activity adaptation; returns null if any validation check fails or denylist is hit. */
export function validateAdaptOutput(reply: unknown): AdaptPick | null {
  const parsed = AdaptReplySchema.safeParse(reply);
  if (!parsed.success) return null;
  const { adaptedTitle, instructions, materials, safetyNotice, explanation } = parsed.data;
  if (
    hitsDenylist(adaptedTitle) ||
    hitsDenylist(safetyNotice) ||
    hitsDenylist(explanation) ||
    instructions.some((step) => hitsDenylist(step)) ||
    materials.some((m) => hitsDenylist(m))
  ) {
    return null;
  }
  return { adaptedTitle, instructions, materials, safetyNotice, explanation };
}

/** Returns the picks, or null when any part of the reply is unacceptable (the whole reply is rejected). */
export function validateOutput(reply: unknown, candidateIds: ReadonlySet<string>, count: number): Pick[] | null {
  const parsed = ReplySchema.safeParse(reply);
  if (!parsed.success) return null;
  const { picks } = parsed.data;
  if (picks.length > count) return null;
  const ids = new Set<string>();
  for (const pick of picks) {
    if (!candidateIds.has(pick.id) || ids.has(pick.id)) return null;
    if (hitsDenylist(pick.why)) return null;
    ids.add(pick.id);
  }
  return picks;
}

const safeText = (maxLen: number) =>
  z.string().trim().min(1).max(maxLen).refine((w) => !/[<>]|https?:\/\/|www\./i.test(w));

const CustomPlaySuggestionSchema = z.object({
  title: safeText(60),
  domain: z.enum(["cognitive", "motor", "language", "socioEmotional"]),
  durationMinutes: z.number().int().min(1).max(120),
  setting: z.enum(["indoor", "outdoor", "either"]),
  usedMaterials: z.array(safeText(50)).max(10),
  instructions: z.array(safeText(200)).min(2).max(5),
  safetyNotice: safeText(140),
  whyPicked: safeText(MAX_WHY_LENGTH)
});

const MaterialAssessmentSchema = z.object({
  input: safeText(50),
  normalizedItem: safeText(50),
  isSafe: z.boolean(),
  reason: safeText(120).optional()
});

const CustomPlayReplySchema = z.object({
  materialAssessments: z.array(MaterialAssessmentSchema).max(10).optional(),
  suggestions: z.array(CustomPlaySuggestionSchema).max(3),
  materialNote: safeText(200).optional()
});

export type MaterialAssessment = z.infer<typeof MaterialAssessmentSchema>;
export type CustomPlaySuggestion = z.infer<typeof CustomPlaySuggestionSchema>;

export interface CustomPlayOutput {
  materialAssessments: MaterialAssessment[];
  suggestions: CustomPlaySuggestion[];
  materialNote?: string;
}

/**
 * Layer 3 post-generation safety net: validates normalized model assessments and generated
 * suggestions; fails closed on any diagnostic wording or hazardous item in normalized output.
 */
export function validateCustomPlayOutput(
  reply: unknown,
  ageBand: AgeBand,
  count: number
): CustomPlayOutput | null {
  const parsed = CustomPlayReplySchema.safeParse(reply);
  if (!parsed.success) return null;

  const materialAssessments = parsed.data.materialAssessments ?? [];
  const suggestions = parsed.data.suggestions.slice(0, count);
  const materialNote = parsed.data.materialNote;
  if (materialNote && hitsDenylist(materialNote)) return null;

  const modelRejectedNormalized = new Set<string>();
  for (const assessment of materialAssessments) {
    if (
      hitsDenylist(assessment.normalizedItem) ||
      (assessment.reason && hitsDenylist(assessment.reason))
    ) {
      return null;
    }
    if (!assessment.isSafe) {
      modelRejectedNormalized.add(assessment.normalizedItem.toLowerCase());
      modelRejectedNormalized.add(assessment.input.toLowerCase());
    } else if (containsHazardousMaterial(assessment.normalizedItem, ageBand)) {
      // Model normalized a typo (e.g., "shampo" -> "shampoo") but still marked it safe: fail closed.
      return null;
    }
  }

  for (const item of suggestions) {
    if (
      hitsDenylist(item.title) ||
      hitsDenylist(item.safetyNotice) ||
      hitsDenylist(item.whyPicked) ||
      item.instructions.some((step) => hitsDenylist(step)) ||
      item.usedMaterials.some((m) => hitsDenylist(m))
    ) {
      return null;
    }
    // Fail closed if the model includes any hazardous item or self-rejected item in normalized output.
    if (
      containsHazardousMaterial(item.title, ageBand) ||
      item.usedMaterials.some(
        (m) => containsHazardousMaterial(m, ageBand) || modelRejectedNormalized.has(m.toLowerCase())
      ) ||
      item.instructions.some((step) => containsHazardousMaterial(step, ageBand))
    ) {
      return null;
    }
  }

  return { materialAssessments, suggestions, ...(materialNote ? { materialNote } : {}) };
}
