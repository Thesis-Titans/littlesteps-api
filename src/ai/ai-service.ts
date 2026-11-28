import { getApprovedActivities, getCatalogActivityById } from "../catalog/catalog-service.js";
import type { CatalogActivity } from "../catalog/types.js";
import { cleanMaterials, screenMaterialsForSafety } from "./sanitize.js";
import { buildAdaptPrompt, buildCustomPlayPrompt, buildPrompt, buildStoryPrompt } from "./prompt.js";
import { filterEligible, rankActivities, FALLBACK_WHY } from "./fallback.js";
import {
  validateAdaptOutput,
  validateCustomPlayOutput,
  validateOutput,
  validateStoryOutput
} from "./validate-output.js";
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

function fallbackResponse(
  suggestions: RecommendationResponse["suggestions"],
  reason?: "NO_REVIEWED_CONTENT",
  materialNote?: string
): RecommendationResponse {
  return {
    suggestions,
    source: "catalog_fallback",
    tier: 3,
    provenance: { badge: null, label: "Our picks", disclaimer: DISCLAIMER, model: null, reviewed: true },
    ...(reason ? { reason } : {}),
    ...(materialNote ? { materialNote } : {})
  };
}

function hasCatalogMaterialOverlap(candidates: CatalogActivity[], materials: string[]): boolean {
  const userTokens = new Set(
    materials
      .flatMap((m) => m.split(/[^a-z0-9]+/i))
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length >= 3 && t !== "and" && t !== "the" && t !== "with")
  );
  if (userTokens.size === 0) return false;
  return candidates.some((candidate) =>
    candidate.materials.some((cm) => {
      const lower = cm.toLowerCase();
      for (const token of userTokens) {
        if (lower.includes(token)) return true;
      }
      return false;
    })
  );
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

function buildMaterialSafetyNote(usedMaterials: string[], skippedUnsafe: string[]): string {
  const skippedList = skippedUnsafe.join(", ");
  const pronoun = skippedUnsafe.length === 1 ? "it isn't" : "they aren't";
  return usedMaterials.length > 0
    ? `Using ${usedMaterials.join(", ")} for safe supervised play; skipped ${skippedList} because ${pronoun} safe for young children to handle or mouth.`
    : `Skipped ${skippedList} because ${pronoun} safe for young children to handle or mouth. Here are reviewed play ideas for this age instead.`;
}

function collectActualUsedMaterials(suggestions: Array<{ usedMaterials: string[] }>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of suggestions) {
    for (const raw of item.usedMaterials) {
      const trimmed = raw.trim();
      const key = trimmed.toLowerCase();
      if (trimmed && !seen.has(key)) {
        seen.add(key);
        result.push(trimmed);
      }
    }
  }
  return result;
}

export async function recommend(
  request: RecommendationRequest,
  provider: AiProvider | null,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<RecommendationResponse> {
  const startedAt = Date.now();
  const approved = await getApprovedActivities();
  if (approved.length === 0) {
    logEvent("ai.no_reviewed_content", 3, startedAt);
    return fallbackResponse([], "NO_REVIEWED_CONTENT");
  }

  const materials = cleanMaterials(request.materials);
  const candidates = filterEligible(approved, request);

  // Hybrid Step 2: when allowCustom is enabled and caregiver-provided materials
  // do not match any reviewed catalog activity, screen for pediatric hazards
  // and ask Gemini for a guardrailed custom idea using only safe items.
  let skippedSafetyNote: string | undefined;
  if (request.allowCustom && materials.length > 0 && !hasCatalogMaterialOverlap(candidates, materials)) {
    const { safeMaterials, skippedUnsafe } = screenMaterialsForSafety(materials, request.ageBand);
    if (skippedUnsafe.length > 0) {
      skippedSafetyNote = buildMaterialSafetyNote(safeMaterials, skippedUnsafe);
    }

    if (provider && safeMaterials.length > 0) {
      try {
        const customPrompt = buildCustomPlayPrompt({
          ageBand: request.ageBand,
          timeMinutes: request.timeMinutes,
          setting: request.setting,
          safeMaterials,
          skippedUnsafeMaterials: skippedUnsafe,
          language: request.language,
          domain: request.domain,
          count: request.count
        });
        const reply = await callWithTimeout(provider, customPrompt, timeoutMs);
        const validated = validateCustomPlayOutput(reply, request.ageBand, request.count);
        if (validated) {
          // Merge Layer 1 extreme-blocked inputs with Layer 2 model-rejected items (using clean normalized names).
          const combinedSkipped: string[] = [];
          const seenSkipped = new Set<string>();
          for (const item of skippedUnsafe) {
            const key = item.toLowerCase();
            if (!seenSkipped.has(key)) {
              seenSkipped.add(key);
              combinedSkipped.push(item);
            }
          }
          for (const a of validated.materialAssessments) {
            if (!a.isSafe) {
              const label = a.normalizedItem.trim() || a.input.trim();
              const key = label.toLowerCase();
              if (label && !seenSkipped.has(key)) {
                seenSkipped.add(key);
                combinedSkipped.push(label);
              }
            }
          }

          if (validated.suggestions.length === 0) {
            // Model judged every provided material unsafe; fall back cleanly to reviewed catalog picks with safety note.
            const allSkippedNote = combinedSkipped.length > 0
              ? buildMaterialSafetyNote([], combinedSkipped)
              : validated.materialNote;
            const ranked = rankActivities(approved, request, []);
            return fallbackResponse(
              ranked.map((activity) => ({
                activityId: activity.id, title: activity.title, whyPicked: FALLBACK_WHY, activity
              })),
              undefined,
              allSkippedNote
            );
          }

          logEvent("ai.custom_ok", 1, startedAt);
          const actualUsed = collectActualUsedMaterials(validated.suggestions);
          const finalNote = combinedSkipped.length > 0
            ? buildMaterialSafetyNote(actualUsed.length > 0 ? actualUsed : safeMaterials, combinedSkipped)
            : validated.materialNote;
          return {
            suggestions: validated.suggestions.map((item, idx) => {
              const duration = Math.min(item.durationMinutes, request.timeMinutes);
              const resolvedSetting = request.setting === "either" ? item.setting : request.setting;
              return {
                activityId: `custom-${idx + 1}`,
                title: item.title,
                whyPicked: item.whyPicked,
                isCustom: true,
                activity: {
                  id: `custom-${idx + 1}`,
                  title: item.title,
                  type: "activity",
                  language: request.language,
                  domain: item.domain,
                  ageBand: request.ageBand,
                  durationMinutes: duration,
                  durationEstimate: `${duration} mins`,
                  setting: resolvedSetting,
                  materials: item.usedMaterials,
                  instructions: item.instructions,
                  limitations: item.safetyNotice,
                  status: "synthetic_fixture",
                  provenanceSource: ""
                }
              };
            }),
            source: "ai_custom",
            tier: 1,
            provenance: {
              badge: "Suggested by AI",
              label: "Material adaptation",
              disclaimer: DISCLAIMER,
              guidance: GUIDANCE,
              model: provider.model,
              reviewed: false
            },
            ...(finalNote ? { materialNote: finalNote } : {})
          };
        }
        logEvent("ai.custom_invalid_output", 3, startedAt);
      } catch (error) {
        logEvent("ai.custom_failed", 3, startedAt, error instanceof Error ? error.name : "Unknown");
      }
    }

    // If all provided materials were unsafe, return reviewed catalog picks with the safety note.
    if (safeMaterials.length === 0 && skippedSafetyNote) {
      const ranked = rankActivities(approved, request, []);
      return fallbackResponse(
        ranked.map((activity) => ({
          activityId: activity.id, title: activity.title, whyPicked: FALLBACK_WHY, activity
        })),
        undefined,
        skippedSafetyNote
      );
    }
  }

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
  return fallbackResponse(
    ranked.map((activity) => ({
      activityId: activity.id, title: activity.title, whyPicked: FALLBACK_WHY, activity
    })),
    undefined,
    skippedSafetyNote
  );
}

/**
 * Deterministically finds a matching catalog activity based on ageBand and book subjects.
 */
export async function findStoryFallbackActivity(
  ageBand: string,
  subjects?: string[]
): Promise<StoryActivitySuggestion> {
  const pool = await getApprovedActivities();

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
  const fallback = await findStoryFallbackActivity(request.ageBand, request.subjects);
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
  const approved = await getApprovedActivities();
  const activity =
    approved.find((a) => a.id === request.activityId) ??
    (await getCatalogActivityById(request.activityId));

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
