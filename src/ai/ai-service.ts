import { getApprovedActivities } from "../catalog/catalog-service.js";
import { SYNTHETIC_ACTIVITIES } from "../catalog/fixtures/catalog-activities.synthetic.js";
import { cleanMaterials } from "./sanitize.js";
import { buildPrompt, buildStoryPrompt, buildChatPrompt } from "./prompt.js";
import { filterEligible, rankActivities, FALLBACK_WHY } from "./fallback.js";
import { validateOutput, validateStoryOutput, validateChatOutput } from "./validate-output.js";
import type { AiProvider } from "./providers/provider.js";
import {
  DISCLAIMER,
  GUIDANCE,
  type RecommendationRequest,
  type RecommendationResponse,
  type StoryActivityRequest,
  type StoryActivityResponse,
  type StoryActivitySuggestion,
  type ChatRequest,
  type ChatResponse
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
export function findStoryFallbackActivity(ageBand: string, subjects: string[]): StoryActivitySuggestion {
  const approved = getApprovedActivities();
  const pool = approved.length > 0 ? approved : SYNTHETIC_ACTIVITIES;

  const eligible = pool.filter((a) => a.ageBand === ageBand);
  const candidatePool = eligible.length > 0 ? eligible : pool;

  const subjectWords = subjects.map((s) => s.toLowerCase());
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

const PEDIATRIC_MEDICAL_PATTERN = /\b(?:fever|sick|illness|cough|vomit|pain|medicine|medication|doctor|pediatrician|hospital|diagnos|autism|adhd|delay|disorder|speech therapy|vaccin)\b/i;

/**
 * Conversational Play Assistant.
 * Strictly answers everyday play and routine queries.
 * Strictly redirects medical or clinical concerns.
 */
export async function chatPlayAssistant(
  request: ChatRequest,
  provider: AiProvider | null,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<ChatResponse> {
  const startedAt = Date.now();

  // 1. Strict Pediatric Non-Diagnostic Guardrail
  if (PEDIATRIC_MEDICAL_PATTERN.test(request.message)) {
    logEvent("ai.chat_medical_guardrail", 1, startedAt);
    return {
      reply: "I can only help with everyday play and routine ideas. For health or developmental questions, please consult your pediatrician or local barangay health worker.",
      suggestedActivity: null,
      provenance: {
        tier: 1,
        source: "pediatric-guardrail",
        badge: "Suggested by AI",
        disclaimer: DISCLAIMER
      }
    };
  }

  // 2. Provider Execution (Gemini / Ollama)
  if (provider) {
    try {
      const prompt = buildChatPrompt({
        message: request.message,
        ageBand: request.ageBand,
        childNickname: request.childNickname
      });
      const reply = await callWithTimeout(provider, prompt, timeoutMs);
      const validated = validateChatOutput(reply);
      if (validated) {
        logEvent("ai.chat_provider_ok", 1, startedAt);
        return {
          reply: validated.reply,
          suggestedActivity: validated.suggestedActivity,
          provenance: {
            tier: 1,
            source: provider.model,
            badge: "Suggested by AI",
            disclaimer: DISCLAIMER
          }
        };
      }
      logEvent("ai.chat_invalid_output", 3, startedAt);
    } catch (error) {
      logEvent("ai.chat_provider_failed", 3, startedAt, error instanceof Error ? error.name : "Unknown");
    }
  }

  // 3. Fallback to Catalog Play Activity
  logEvent("ai.chat_fallback", 3, startedAt);
  const fallback = findStoryFallbackActivity(request.ageBand, [request.message]);
  return {
    reply: `Here is a fun play idea to try${request.childNickname ? ` with ${request.childNickname}` : ""} using everyday items around the house!`,
    suggestedActivity: {
      title: fallback.title,
      domain: fallback.domain,
      durationMinutes: 10,
      instructions: fallback.instructions,
      materials: ["Common household items"],
      safetyNotice: fallback.safetyNotice
    },
    provenance: {
      tier: 3,
      source: "catalog",
      badge: null,
      disclaimer: DISCLAIMER
    }
  };
}
