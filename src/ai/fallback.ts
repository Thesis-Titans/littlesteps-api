import type { CatalogActivity } from "../catalog/types.js";
import type { RecommendationRequest } from "./types.js";

export const FALLBACK_WHY = "A good fit for this age, with the time and play space you have.";

type Criteria = Pick<RecommendationRequest, "ageBand" | "language" | "setting" | "timeMinutes">;

/** Hard filters shared by the prompt candidates and the deterministic ranker. */
export function filterEligible(items: CatalogActivity[], criteria: Criteria): CatalogActivity[] {
  return items.filter((item) =>
    item.ageBand === criteria.ageBand &&
    item.language === criteria.language &&
    (criteria.setting === "either" || item.setting === criteria.setting || item.setting === "either") &&
    item.durationMinutes <= criteria.timeMinutes
  );
}

/** Domain match, then material overlap, then shorter duration; ties broken by id ascending. No randomness. */
export function rankActivities(
  items: CatalogActivity[],
  request: Criteria & { domain?: string; count: number },
  materials: string[]
): CatalogActivity[] {
  const have = new Set(materials);
  const score = (item: CatalogActivity) => ({
    domain: request.domain && item.domain === request.domain ? 1 : 0,
    overlap: item.materials.filter((m) => have.has(m.toLowerCase())).length
  });
  return filterEligible(items, request)
    .map((item) => ({ item, ...score(item) }))
    .sort((a, b) =>
      b.domain - a.domain ||
      b.overlap - a.overlap ||
      a.item.durationMinutes - b.item.durationMinutes ||
      (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0)
    )
    .slice(0, request.count)
    .map((entry) => entry.item);
}
