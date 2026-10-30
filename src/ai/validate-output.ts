import { z } from "zod";

// Non-diagnostic wording rule: docs/ui-ux-design-specification.md section 8 and
// security-privacy-ai.md NFR-AI-04. Matched case-insensitively on whole-word starts.
export const NON_DIAGNOSTIC_DENYLIST: readonly string[] = [
  "delay", "delayed", "disorder", "diagnos", "autis", "adhd", "assess", "treat", "therapy",
  "therapist", "clinical", "abnormal", "behind", "deficit", "screening score", "red flag",
  "impair", "disabilit", "syndrome", "milestone"
];

const denylistPattern = new RegExp(`\\b(?:${NON_DIAGNOSTIC_DENYLIST.join("|")})`, "i");
export const MAX_WHY_LENGTH = 140;

const ReplySchema = z.object({
  picks: z.array(z.object({ id: z.string(), why: z.string().max(MAX_WHY_LENGTH) })).min(1)
});

export interface Pick {
  id: string;
  why: string;
}

/** Returns the picks, or null when any part of the reply is unacceptable (the whole reply is rejected). */
export function validateOutput(reply: unknown, candidateIds: ReadonlySet<string>, count: number): Pick[] | null {
  const parsed = ReplySchema.safeParse(reply);
  if (!parsed.success) return null;
  const { picks } = parsed.data;
  if (picks.length > count) return null;
  const ids = new Set<string>();
  for (const pick of picks) {
    if (!candidateIds.has(pick.id) || ids.has(pick.id)) return null;
    if (denylistPattern.test(pick.why)) return null;
    ids.add(pick.id);
  }
  return picks;
}
