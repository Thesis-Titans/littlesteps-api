import { deriveAgeBand } from "./age.js";
import type { CreateChildInput, UpdateChildInput } from "./schemas.js";
import type { PublicChild, StoredChild } from "./types.js";

/** Create: input must already be validated and range-checked (assertBirthMonthInRange). */
export function toStored(input: CreateChildInput, caregiverId: string, id: string, now: Date): StoredChild {
  const iso = now.toISOString();
  const stored: StoredChild = {
    id,
    caregiverId,
    name: input.nickname,
    ageBand: input.birthMonthYear ? deriveAgeBand(input.birthMonthYear, now) : input.ageBand!,
    createdAt: iso,
    updatedAt: iso
  };
  if (input.birthMonthYear) stored.birthMonth = input.birthMonthYear;
  return stored;
}

/** Update: returns a new record; id, caregiverId and createdAt stay unchanged. Choosing ageBand drops birthMonth (D3). */
export function applyUpdate(stored: StoredChild, input: UpdateChildInput, now: Date): StoredChild {
  const next: StoredChild = { ...stored, updatedAt: now.toISOString() };
  if (input.nickname !== undefined) next.name = input.nickname;
  if (input.birthMonthYear !== undefined) {
    next.birthMonth = input.birthMonthYear;
    next.ageBand = deriveAgeBand(input.birthMonthYear, now);
  } else if (input.ageBand !== undefined) {
    delete next.birthMonth;
    next.ageBand = input.ageBand;
  }
  return next;
}

export function toPublic(stored: StoredChild, now: Date): PublicChild {
  const out: PublicChild = {
    id: stored.id,
    nickname: stored.name,
    ageBand: stored.birthMonth ? deriveAgeBand(stored.birthMonth, now) : stored.ageBand,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt
  };
  if (stored.birthMonth) out.birthMonthYear = stored.birthMonth;
  return out;
}
