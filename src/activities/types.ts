export type PlanStatus = "planned" | "completed" | "skipped";

export interface StoredPlan {
  id: string;
  childId: string;
  caregiverId: string;
  activityId: string;
  scheduledDate: string; // YYYY-MM-DD
  status: PlanStatus;
  completedAt?: string; // ISO 8601
  durationMinutes?: number;
  feedbackNote?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface PublicPlan {
  id: string;
  childId: string;
  activityId: string;
  scheduledDate: string;
  status: PlanStatus;
  completedAt?: string;
  durationMinutes?: number;
  feedbackNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlansListFilter {
  date?: string;
  status?: PlanStatus;
}
