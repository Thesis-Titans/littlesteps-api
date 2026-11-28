import type { CatalogActivity, Language } from "../catalog/types.js";
import type { RecommendationRequest } from "./types.js";

export const FALLBACK_WHY = "A good fit for this age, with the time and play space you have.";

/** Returns a short caregiver-facing fallback explanation localized to the selected language. */
export function fallbackWhy(language: Language): string {
  switch (language) {
    case "fil":
      return "Bagay ito sa edad ng iyong anak at sa oras at lugar na mayroon kayo.";
    case "hil":
      return "Bagay ini sa edad sang imo bata kag sa oras kag lugar nga ara sa inyo.";
    default:
      return FALLBACK_WHY;
  }
}

type Criteria = Pick<RecommendationRequest, "ageBand" | "language" | "setting" | "timeMinutes">;

/** Hard filters shared by the prompt candidates and the deterministic ranker. */
export function filterEligible(items: CatalogActivity[], criteria: Criteria): CatalogActivity[] {
  const baseEligible = items.filter((item) =>
    item.ageBand === criteria.ageBand &&
    (criteria.setting === "either" || item.setting === criteria.setting || item.setting === "either") &&
    item.durationMinutes <= criteria.timeMinutes
  );
  const exactLanguage = baseEligible.filter((item) => item.language === criteria.language);
  return exactLanguage.length > 0 ? exactLanguage : baseEligible;
}

/** Language preference, domain match, material overlap, then shorter duration; ties broken by id ascending. */
export function rankActivities(
  items: CatalogActivity[],
  request: Criteria & { domain?: string; count: number },
  materials: string[]
): CatalogActivity[] {
  const have = new Set(materials);
  const score = (item: CatalogActivity) => ({
    languageRank: item.language === request.language ? 2 : item.language === "en" ? 1 : 0,
    domain: request.domain && item.domain === request.domain ? 1 : 0,
    overlap: item.materials.filter((m) => have.has(m.toLowerCase())).length
  });
  return filterEligible(items, request)
    .map((item) => ({ item, ...score(item) }))
    .sort((a, b) =>
      b.languageRank - a.languageRank ||
      b.domain - a.domain ||
      b.overlap - a.overlap ||
      a.item.durationMinutes - b.item.durationMinutes ||
      (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0)
    )
    .slice(0, request.count)
    .map((entry) => entry.item);
}
