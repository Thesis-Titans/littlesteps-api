import { getApprovedActivities } from "../catalog/catalog-service.js";
import { cleanMaterials } from "./sanitize.js";
import { buildPrompt } from "./prompt.js";
import { filterEligible, rankActivities, FALLBACK_WHY } from "./fallback.js";
import { validateOutput } from "./validate-output.js";
import type { AiProvider } from "./providers/provider.js";
import { DISCLAIMER, GUIDANCE, type RecommendationRequest, type RecommendationResponse } from "./types.js";

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
