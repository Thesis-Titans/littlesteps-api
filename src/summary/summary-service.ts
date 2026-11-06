import type { StoredPlan } from "../activities/types.js";
import { getCatalogActivityById } from "../catalog/catalog-service.js";
import { SYNTHETIC_ACTIVITIES } from "../catalog/fixtures/catalog-activities.synthetic.js";
import type { Domain } from "../catalog/types.js";
import type { StoredMilestoneObservation } from "../milestones/types.js";
import type { DomainDistribution, WeeklySummary } from "./types.js";

/**
 * Returns the ISO week boundaries (Monday–Sunday inclusive, UTC) for a given ISO week string.
 * @param isoWeek e.g. "2026-W45" — must already be validated.
 */
export function isoWeekBounds(isoWeek: string): { weekStart: string; weekEnd: string } {
  const [yearStr, weekStr] = isoWeek.split("-W");
  const year = Number(yearStr);
  const week = Number(weekStr);

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));

  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd: sunday.toISOString().slice(0, 10)
  };
}

/**
 * Returns the ISO week string (e.g. "2026-W45") for the week containing a given UTC date.
 */
export function currentIsoWeek(now = new Date()): string {
  const thursday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dow = thursday.getUTCDay() || 7;
  thursday.setUTCDate(thursday.getUTCDate() + (4 - dow));

  const isoYear = thursday.getUTCFullYear();

  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Dow = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));

  const diffMs = thursday.getTime() - week1Monday.getTime();
  const week = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;

  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Resolves an activity's developmental domain.
 * Looks up catalog store first, then fallback synthetic fixtures, then domain identifiers.
 */
export function resolveActivityDomain(activityId: string): Domain | undefined {
  const fromCatalog = getCatalogActivityById(activityId);
  if (fromCatalog) return fromCatalog.domain;

  const fromSynthetic = SYNTHETIC_ACTIVITIES.find((a) => a.id === activityId);
  if (fromSynthetic) return fromSynthetic.domain;

  if (/(?:^|[-_])(?:cog|cognitive)(?:[-_]|$)/i.test(activityId)) return "cognitive";
  if (/(?:^|[-_])(?:mot|motor)(?:[-_]|$)/i.test(activityId)) return "motor";
  if (/(?:^|[-_])(?:lan|lang|language)(?:[-_]|$)/i.test(activityId)) return "language";
  if (/(?:^|[-_])(?:soc|socio|socioemotional)(?:[-_]|$)/i.test(activityId)) return "socioEmotional";

  return undefined;
}

/**
 * Generates an educational, supportive caregiver reflection prompt.
 * Strictly non-diagnostic and free of clinical claims or pass/fail evaluation (FR-05).
 */
export function generateReflectionPrompt(completedCount: number, milestoneCount: number): string {
  if (completedCount === 0 && milestoneCount === 0) {
    return "Every week brings new moments to observe and share with your child. When you are ready, try exploring simple everyday activities together.";
  }
  if (completedCount > 0 && milestoneCount === 0) {
    return "You explored shared activities together this week. Continue engaging with everyday play and responsive routines that bring curiosity and joy.";
  }
  if (completedCount === 0 && milestoneCount > 0) {
    return "You recorded developmental milestones observed in everyday routines this week. Celebrating these emerging moments supports responsive caregiving.";
  }
  return "You engaged in shared activities and noted emerging milestones this week. Continuing everyday playful interactions nurtures learning and connection.";
}

/**
 * Deterministically computes weekly summary metrics over a 7-day UTC date window.
 * Strictly non-diagnostic: aggregates counts and distributions without clinical scoring.
 */
export function computeWeeklySummary(
  plans: StoredPlan[],
  milestones: StoredMilestoneObservation[],
  weekStart: string,
  weekEnd: string,
  weekId: string,
  now = new Date()
): WeeklySummary {
  // Filter plans scheduled within the week window
  const weekPlans = plans.filter((p) => p.scheduledDate >= weekStart && p.scheduledDate <= weekEnd);
  const completedPlans = weekPlans.filter((p) => p.status === "completed");

  // Filter milestone observations observed within the week window
  const observedMilestones = milestones.filter(
    (m) => m.status === "observed" && m.observedDate >= weekStart && m.observedDate <= weekEnd
  );

  // Compute developmental domain distribution for completed activities
  const domainDistribution: DomainDistribution = {
    cognitive: 0,
    motor: 0,
    language: 0,
    socioEmotional: 0
  };

  for (const plan of completedPlans) {
    const domain = resolveActivityDomain(plan.activityId);
    if (domain && domain in domainDistribution) {
      domainDistribution[domain]++;
    }
  }

  // Determine top 3 completed activity IDs by frequency
  const frequency = new Map<string, number>();
  for (const plan of completedPlans) {
    frequency.set(plan.activityId, (frequency.get(plan.activityId) ?? 0) + 1);
  }
  const topActivityIds = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([id]) => id);

  return {
    id: weekId,
    weekStartDate: weekStart,
    weekEndDate: weekEnd,
    completedActivityCount: completedPlans.length,
    observedMilestoneCount: observedMilestones.length,
    totalPlannedActivities: weekPlans.length,
    domainDistribution,
    topActivityIds,
    reflectionPrompt: generateReflectionPrompt(completedPlans.length, observedMilestones.length),
    generatedAt: now.toISOString()
  };
}
