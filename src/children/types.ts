import type { AgeBand } from "../catalog/types.js";

export type { AgeBand };

export interface StoredChild {
  id: string;
  caregiverId: string;
  name: string;
  birthMonth?: string; // "YYYY-MM"
  ageBand: AgeBand;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface PublicChild {
  id: string;
  nickname: string;
  birthMonthYear?: string;
  ageBand: AgeBand;
  createdAt: string;
  updatedAt: string;
}
