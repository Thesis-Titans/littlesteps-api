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

export interface JournalListFilter {
  date?: string;
}
