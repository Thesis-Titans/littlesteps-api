import { getApprovedActivities } from "../catalog/catalog-service.js";
import { SYNTHETIC_ACTIVITIES } from "../catalog/fixtures/catalog-activities.synthetic.js";
import { cleanMaterials } from "./sanitize.js";
import { buildAdaptPrompt, buildPrompt, buildStoryPrompt } from "./prompt.js";
import { filterEligible, rankActivities, FALLBACK_WHY } from "./fallback.js";
import { validateAdaptOutput, validateOutput, validateStoryOutput } from "./validate-output.js";
import type { AiProvider } from "./providers/provider.js";
import {
  DISCLAIMER,
  GUIDANCE,
  type AdaptActivityRequest,
  type AdaptActivityResponse,
  type RecommendationRequest,
  type RecommendationResponse,
  type StoryActivityRequest,
  type StoryActivityResponse,
  type StoryActivitySuggestion
} from "./types.js";

export const PROVIDER_TIMEOUT_MS = 8000;

// Logs the event only: never prompts, replies, materials or user identifiers.
function logEvent(event: string, tier: number, startedAt: number, errorClass?: string): void {
  console.info(JSON.stringify({ event, tier, latencyMs: Date.now() - startedAt, ...(errorClass ? { errorClass } : {}) }));
}

function fallbackResponse(suggestions: RecommendationResponse["suggestions"], reason?: "NO_REVIEWED_CONTENT"): RecommendationResponse {
  return {
    suggestions,
    source: "catalog_fallback",
    tier: 3,
    provenance: { badge: null, label: "Our picks", disclaimer: DISCLAIMER, model: null, reviewed: true },
    ...(reason ? { reason } : {})
  };
}

async function callWithTimeout(provider: AiProvider, prompt: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      provider.suggest(prompt, controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("provider timeout")));
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function recommend(
  request: RecommendationRequest,
  provider: AiProvider | null,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<RecommendationResponse> {
  const startedAt = Date.now();
  const approved = getApprovedActivities();
  if (approved.length === 0) {
    logEvent("ai.no_reviewed_content", 3, startedAt);
    return fallbackResponse([], "NO_REVIEWED_CONTENT");
  }

  const materials = cleanMaterials(request.materials);
  const candidates = filterEligible(approved, request);

  if (provider && candidates.length > 0) {
    try {
      const prompt = buildPrompt({
        ageBand: request.ageBand,
        timeMinutes: request.timeMinutes,
        setting: request.setting,
        materials,
        language: request.language,
        count: request.count,
        candidates: candidates.map(({ id, title, domain, materials: m }) => ({ id, title, domain, materials: m }))
      });
      const reply = await callWithTimeout(provider, prompt, timeoutMs);
      const picks = validateOutput(reply, new Set(candidates.map((c) => c.id)), request.count);
      if (picks) {
        const byId = new Map(candidates.map((c) => [c.id, c]));
        logEvent("ai.provider_ok", 1, startedAt);
        return {
          suggestions: picks.map((p) => {
            const activity = byId.get(p.id)!;
            return { activityId: activity.id, title: activity.title, whyPicked: p.why, activity };
          }),
          source: "ai",
          tier: 1,
          provenance: {
            badge: "Suggested by AI",
            label: null,
            disclaimer: DISCLAIMER,
            guidance: GUIDANCE,
            model: provider.model,
            reviewed: true
          }
        };
      }
      logEvent("ai.invalid_output", 3, startedAt);
    } catch (error) {
      logEvent("ai.provider_failed", 3, startedAt, error instanceof Error ? error.name : "Unknown");
    }
  }

  const ranked = rankActivities(approved, request, materials);
  return fallbackResponse(ranked.map((activity) => ({
    activityId: activity.id, title: activity.title, whyPicked: FALLBACK_WHY, activity
  })));
}

/**
 * Deterministically finds a matching catalog activity based on ageBand and book subjects.
 */
export function findStoryFallbackActivity(ageBand: string, subjects?: string[]): StoryActivitySuggestion {
  const approved = getApprovedActivities();
  const pool = approved.length > 0 ? approved : SYNTHETIC_ACTIVITIES;

  const eligible = pool.filter((a) => a.ageBand === ageBand);
  const candidatePool = eligible.length > 0 ? eligible : pool;

  const subjectWords = (subjects ?? []).map((s) => s.toLowerCase());
  let matched = candidatePool.find((a) => {
    const text = `${a.title} ${a.domain}`.toLowerCase();
    return subjectWords.some((w) => text.includes(w));
  });

  if (!matched && candidatePool.length > 0) {
    matched = candidatePool[0];
  }

  if (matched) {
    return {
      title: matched.title,
      domain: matched.domain,
      instructions: Array.isArray(matched.instructions) ? matched.instructions.join(" ") : String(matched.instructions),
      safetyNotice: "Ensure adult supervision during all play activities."
    };
  }

  return {
    title: "Story Discussion and Rhyme",
    domain: "language",
    instructions: "Talk about the characters and pictures in the book together. Ask your child to point to familiar objects.",
    safetyNotice: "Ensure adult supervision during play."
  };
}

/**
 * Suggests a companion play activity for a children's storybook.
 * Tier 1: LLM provider (Gemini / Ollama), bounded at 8s.
 * Tier 3: Deterministic catalog fallback on any failure, timeout, or denylist violation.
 */
export async function suggestStoryActivity(
  request: StoryActivityRequest,
  provider: AiProvider | null,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<StoryActivityResponse> {
  const startedAt = Date.now();
  const bookTitle = (request.bookTitle ?? request.title)!.trim();

  if (provider) {
    try {
      const prompt = buildStoryPrompt({
        bookTitle,
        subjects: request.subjects,
        ageBand: request.ageBand
      });
      const reply = await callWithTimeout(provider, prompt, timeoutMs);
      const validated = validateStoryOutput(reply);
      if (validated) {
        logEvent("ai.story_provider_ok", 1, startedAt);
        return {
          bookTitle,
          suggestion: validated,
          provenance: {
            tier: 1,
            source: provider.model,
            badge: "Suggested by AI",
            disclaimer: DISCLAIMER
          }
        };
      }
      logEvent("ai.story_invalid_output", 3, startedAt);
    } catch (error) {
      logEvent("ai.story_provider_failed", 3, startedAt, error instanceof Error ? error.name : "Unknown");
    }
  }

  logEvent("ai.story_fallback", 3, startedAt);
  const fallback = findStoryFallbackActivity(request.ageBand, request.subjects);
  return {
    bookTitle,
    suggestion: fallback,
    provenance: {
      tier: 3,
      source: "catalog",
      badge: null,
      disclaimer: DISCLAIMER
    }
  };
}

/**
 * Adapts an activity based on parent constraints (Issue #61, ADR-012).
 * Tier 1: LLM provider (Gemini).
 * Tier 2: Safe heuristic adaptation from the reviewed catalog activity.
 */
export async function adaptActivity(
  request: AdaptActivityRequest,
  provider: AiProvider | null,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<AdaptActivityResponse | null> {
  const startedAt = Date.now();
  const approved = getApprovedActivities();
  const pool = approved.length > 0 ? approved : SYNTHETIC_ACTIVITIES;
  const activity = pool.find((a) => a.id === request.activityId);

  if (!activity) {
    return null;
  }

  const instructions = Array.isArray(activity.instructions) ? activity.instructions : [String(activity.instructions)];
  const materials = Array.isArray(activity.materials) ? activity.materials : [];

  if (provider) {
    try {
      const prompt = buildAdaptPrompt({
        activityTitle: activity.title,
        domain: activity.domain,
        instructions,
        materials,
        ageBand: request.ageBand ?? activity.ageBand,
        adjustment: request.adjustment,
        missingMaterial: request.missingMaterial
      });
      const reply = await callWithTimeout(provider, prompt, timeoutMs);
      const validated = validateAdaptOutput(reply);
      if (validated) {
        logEvent("ai.adapt_provider_ok", 1, startedAt);
        return {
          adapted: {
            activityId: activity.id,
            originalTitle: activity.title,
            adaptedTitle: validated.adaptedTitle,
            adjustment: request.adjustment,
            instructions: validated.instructions,
            materials: validated.materials,
            safetyNotice: validated.safetyNotice,
            explanation: validated.explanation
          },
          source: "ai",
          tier: 1,
          provenance: {
            badge: "Suggested by AI",
            disclaimer: DISCLAIMER,
            model: provider.model
          }
        };
      }
      logEvent("ai.adapt_invalid_output", 2, startedAt);
    } catch (error) {
      logEvent("ai.adapt_provider_failed", 2, startedAt, error instanceof Error ? error.name : "Unknown");
    }
  }

  // Safe Tier 2 deterministic fallback
  logEvent("ai.adapt_fallback", 2, startedAt);
  let adaptedTitle = `Adapted: ${activity.title}`;
  let adaptedInstructions = [...instructions];
  let adaptedMaterials = [...materials];
  let explanation = "Adapted for home play while maintaining developmental focus.";

  switch (request.adjustment) {
    case "shorter":
      adaptedTitle = `Quick: ${activity.title}`;
      adaptedInstructions = instructions.slice(0, Math.min(2, instructions.length));
      explanation = "Condensed into a quick 5-10 minute exploratory session.";
      break;
    case "easier":
      adaptedTitle = `Gentle: ${activity.title}`;
      adaptedInstructions = [`Demonstrate ${activity.title.toLowerCase()} gently first before inviting your child to try.`, ...instructions.slice(0, 2)];
      explanation = "Simplified with hands-on caregiver demonstration.";
      break;
    case "harder":
      adaptedTitle = `Challenge: ${activity.title}`;
      adaptedInstructions = [...instructions, "Encourage your toddler to explore variations independently or count each step!"];
      explanation = "Added an open-ended challenge step to extend problem solving.";
      break;
    case "missing_material": {
      const missing = request.missingMaterial?.trim();
      adaptedTitle = `Home Play: ${activity.title}`;
      adaptedMaterials = materials
        .filter((m) => !missing || !m.toLowerCase().includes(missing.toLowerCase()))
        .concat(["Safe everyday household alternative"]);
      if (missing) {
        adaptedInstructions = instructions.map((step) =>
          step.replace(new RegExp(missing, "gi"), "household alternative")
        );
        explanation = `Substituted ${missing} with everyday safe household items.`;
      } else {
        explanation = "Adapted to use safe household alternatives instead of missing items.";
      }
      break;
    }
  }

  return {
    adapted: {
      activityId: activity.id,
      originalTitle: activity.title,
      adaptedTitle,
      adjustment: request.adjustment,
      instructions: adaptedInstructions,
      materials: adaptedMaterials,
      safetyNotice: activity.limitations ?? "Ensure attentive adult supervision during play.",
      explanation
    },
    source: "fallback",
    tier: 2,
    provenance: {
      badge: null,
      disclaimer: DISCLAIMER,
      model: null
    }
  };
}
