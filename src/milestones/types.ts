export type MilestoneStatus = "observed" | "not_yet_observed" | "not_sure";

export interface StoredMilestoneObservation {
  id: string;
  childId: string;
  caregiverId: string;
  milestoneId: string;
  status: MilestoneStatus;
  observedDate: string; // YYYY-MM-DD
  notes?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface PublicMilestoneObservation {
  id: string;
  childId: string;
  milestoneId: string;
  status: MilestoneStatus;
  observedDate: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MilestonesListFilter {
  status?: MilestoneStatus;
  milestoneId?: string;
}
