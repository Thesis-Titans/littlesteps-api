import type { Domain, Setting } from "../catalog/types.js";

export type PlanStatus = "planned" | "completed" | "skipped";

export interface CustomPlanActivity {
  title: string;
  domain: Domain;
  durationMinutes: number;
  setting: Setting;
  materials: string[];
  instructions: string[];
  safetyNotice?: string;
  sourceLabel?: string;
}

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
  customActivity?: CustomPlanActivity;
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
  customActivity?: CustomPlanActivity;
  createdAt: string;
  updatedAt: string;
}

export interface PlansListFilter {
  date?: string;
  status?: PlanStatus;
}
