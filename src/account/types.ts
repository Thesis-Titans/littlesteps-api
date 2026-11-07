import type { PublicPlan } from "../activities/types.js";
import type { PublicChild } from "../children/types.js";
import type { PublicMilestoneObservation } from "../milestones/types.js";

export interface WeatherLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export interface StoredCaregiverProfile {
  uid: string;
  email?: string;
  displayName?: string;
  weatherLocation?: WeatherLocation;
  createdAt?: string;
  updatedAt?: string;
}

export type PublicCaregiverProfile = StoredCaregiverProfile;

export interface StoredJournalEntry {
  id: string;
  childId: string;
  caregiverId: string;
  entryDate: string; // YYYY-MM-DD
  content: string;
  linkedMilestoneId?: string;
  linkedActivityId?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface PublicJournalEntry {
  id: string;
  childId: string;
  entryDate: string;
  content: string;
  linkedMilestoneId?: string;
  linkedActivityId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountExport {
  exportedAt: string;
  profile: PublicCaregiverProfile;
  children: PublicChild[];
  plans: PublicPlan[];
  observations: PublicMilestoneObservation[];
  journalEntries: PublicJournalEntry[];
}

