import type { AgeBand } from "./types.js";

export const MAX_MONTHS = 71;

/** Future or older than 71 months; the caller maps this to 422 UNPROCESSABLE_ENTITY. */
export class AgeRangeError extends Error {
  constructor() {
    super("Child age must be between 0 and 71 months");
    this.name = "AgeRangeError";
  }
}

export function monthsBetween(birth: string, now: Date): number {
  const [y, m] = birth.split("-").map(Number);
  return now.getUTCFullYear() * 12 + (now.getUTCMonth() + 1) - (y * 12 + m);
}

const BANDS: AgeBand[] = ["0-5m", "6-11m", "12-23m", "24-35m", "36-47m", "48-59m", "60-71m"];

export function bandForMonths(n: number): AgeBand {
  if (n < 6) return BANDS[0];
  if (n < 12) return BANDS[1];
  return BANDS[Math.min(Math.floor(n / 12) + 1, 6)];
}

/** Read path: never throws; a child past 71 months stays at 60-71m. */
export function deriveAgeBand(birth: string, now: Date): AgeBand {
  return bandForMonths(monthsBetween(birth, now));
}

/** Create/edit path: throws AgeRangeError outside 0..71 months. */
export function assertBirthMonthInRange(birth: string, now: Date): void {
  const n = monthsBetween(birth, now);
  if (n < 0 || n > MAX_MONTHS) throw new AgeRangeError();
}
