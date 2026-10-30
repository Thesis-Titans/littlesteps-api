import { z } from "zod";

// Non-diagnostic wording rule: docs/ui-ux-design-specification.md section 8 and
// security-privacy-ai.md NFR-AI-04. Text is normalised first (Unicode, lookalikes, case); fail closed on any match.
export const NON_DIAGNOSTIC_DENYLIST: readonly string[] = [
  "delay", "disorder", "diagnos", "autis", "adhd", "assessment", "assessing", "assessed", "treatment",
  "treating", "therapy", "therapist", "clinical", "abnormal", "falling behind", "behind in",
  "developmentally delayed", "developmental concern", "developmental problem", "developmental issue",
  "deficit", "screening score", "red flag", "impair", "disabilit", "syndrome", "milestone",
  // Filipino terms (Hiligaynon is not covered yet). shortcut: needs review by a Filipino speaker, extend with hil terms.
  "antala", "naantala", "nagkaantala", "pagkaantala", "kapansanan", "sakit sa pag-iisip"
];

// Common Cyrillic/Greek lookalikes folded to Latin. shortcut: small explicit map, extend if new ones show up.
const LOOKALIKES: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "у": "y",
  "ԁ": "d", "ɡ": "g", "ο": "o", "ν": "v", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ρ": "p", "τ": "t", "υ": "u", "χ": "x"
};

function normalise(text: string): string {
  return text
    .normalize("NFKC")
    // Accents are removed for matching only; the stored text is untouched.
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .toLowerCase()
    .replace(/\P{ASCII}/gu, (ch) => LOOKALIKES[ch] ?? ch)
    .replace(/ +/g, " ")
    .trim();
}

const denylistPattern = new RegExp(
  `\\b(?:${NON_DIAGNOSTIC_DENYLIST.map((t) => t.replace(/ /g, "\\s+")).join("|")})`
);

function hitsDenylist(text: string): boolean {
  const base = normalise(text);
  // Second variant: punctuation between letters removed, so "de-lay" and "de_lay" still match.
  const joined = base.replace(/(?<=\p{L})[\p{P}\p{S}]+(?=\p{L})/gu, "");
  return denylistPattern.test(base) || denylistPattern.test(joined);
}

export const MAX_WHY_LENGTH = 140;

const ReplySchema = z.object({
  picks: z.array(z.object({ id: z.string(), why: z.string().trim().min(1).max(MAX_WHY_LENGTH)
      .refine((w) => !/[<>]|https?:\/\/|www\./i.test(w)) })).min(1)
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
    if (hitsDenylist(pick.why)) return null;
    ids.add(pick.id);
  }
  return picks;
}
