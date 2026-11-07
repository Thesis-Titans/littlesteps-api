export interface DomainDistribution {
  cognitive: number;
  motor: number;
  language: number;
  socioEmotional: number;
}

export interface WeeklySummary {
  /** ISO week identifier, e.g. "2026-W45". */
  id: string;
  /** ISO date string of Monday starting the week (UTC, YYYY-MM-DD). */
  weekStartDate: string;
  /** ISO date string of Sunday ending the week (UTC, YYYY-MM-DD). */
  weekEndDate: string;
  /** Number of plans with status "completed" whose scheduledDate falls within the week. */
  completedActivityCount: number;
  /** Number of milestone observations with status "observed" whose observedDate falls within the week. */
  observedMilestoneCount: number;
  /** Total number of scheduled plans (any status) within the week. */
  totalPlannedActivities: number;
  /** Distribution of completed activities across early learning developmental domains. */
  domainDistribution: DomainDistribution;
  /** Up to 3 most frequently completed activity IDs in descending order. */
  topActivityIds: string[];
  /** Factual, supportive educational reflection prompt (non-diagnostic). */
  reflectionPrompt: string;
  /** UTC generation timestamp (ISO 8601). */
  generatedAt: string;
}
