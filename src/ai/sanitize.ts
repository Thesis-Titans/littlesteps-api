import type { AgeBand } from "../catalog/types.js";

const MAX_MATERIAL_LENGTH = 40;

// Layer 1 (Thin Input Gate): block only extreme, unambiguous dangers before calling the LLM.
// Everyday household items, typos (e.g., "shampo"), and Filipino/Hiligaynon terms pass to
// Layer 2 (Gemini structured assessment) and are verified post-generation by Layer 3.
const EXTREME_INPUT_HAZARD_PATTERN =
  /\b(bleach|knife|knives|blade|razor|fire|flame|lighter|medicine|pill|poison|pesticide|insecticide|chemical|acetone|acid)\b/i;

// Layer 3 (Post-Generation Safety Net): deterministic check run against Gemini's clean,
// normalized output (materialsNeeded, titles, steps) to catch any model slips.
const OUTPUT_HAZARD_PATTERN =
  /\b(shampoo|conditioner|soap|detergent|bleach|cleaner|disinfectant|sanitizer|alcohol|lotion|perfume|toothpaste|makeup|cosmetics?|nail\s*polish|acetone|paint|glue|adhesive|chemical|pesticide|insecticide|medicine|pill|vitamin|knife|knives|scissor|scissors|blade|razor|needle|pins?|nail|screw|staple|paperclips?|toothpicks?|glass|shard|lighter|match(?:stick)?s?|candle|fire|flame|stove|boiling|hot\s*water|iron|battery|batteries|charger|wire|cord|cables?|plugs?|sockets?|outlet|cell\s*phones?|cellphones?|smartphones?|phones?|tablets?|laptops?|remote|plastic\s*(?:grocery\s*)?bags?|strings?|ropes?)\b/i;

const OUTPUT_TODDLER_CHOKING_PATTERN =
  /\b(coins?|marbles?|buttons?|beads?|pebbles?|stones?|rocks?|magnets?|balloons?|popcorn|grapes?|peanuts?|nuts?|seeds?|raw\s*carrots?|bottle\s*caps?|small\s*caps?|caps?|lids?)\b/i;

const NON_MATERIAL_PROBE_PATTERN =
  /\b(ignore|override|system|prompt|instruction|diagnos|autis|adhd|delay|therap|assess|clinical|disorder|deficit|syndrome|antala|kapansanan)\b/i;

const TODDLER_BANDS: ReadonlySet<AgeBand> = new Set(["0-5m", "6-11m", "12-23m", "24-35m"]);

/** Lowercases, trims, strips control and format characters, truncates, dedupes and drops empties. */
export function cleanMaterials(materials: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of materials) {
    const collapsed = raw
      .replace(/[\p{Z}\t\r\n]+/gu, " ")
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .toLowerCase()
      .trim();
    const cleaned = Array.from(collapsed).slice(0, MAX_MATERIAL_LENGTH).join("").trim();
    if (cleaned) seen.add(cleaned);
  }
  return [...seen];
}

/** Layer 3 check: returns true if normalized model output [text] references an item unsafe for [ageBand]. */
export function containsHazardousMaterial(text: string, ageBand: AgeBand): boolean {
  if (OUTPUT_HAZARD_PATTERN.test(text)) return true;
  if (TODDLER_BANDS.has(ageBand) && OUTPUT_TODDLER_CHOKING_PATTERN.test(text)) return true;
  return false;
}

/**
 * Layer 1 thin input gate: strips prompt-injection/clinical probes and blocks only extreme,
 * unambiguous dangers before sending household items to Gemini for semantic safety assessment.
 */
export function screenMaterialsForSafety(
  materials: string[],
  _ageBand: AgeBand
): { safeMaterials: string[]; skippedUnsafe: string[] } {
  const safeMaterials: string[] = [];
  const skippedUnsafe: string[] = [];
  for (const item of materials) {
    if (item === "none" || item === "no materials") continue;
    if (EXTREME_INPUT_HAZARD_PATTERN.test(item)) {
      skippedUnsafe.push(item);
    } else if (NON_MATERIAL_PROBE_PATTERN.test(item)) {
      // Drop prompt-injection or clinical-query strings without echoing them back.
      continue;
    } else {
      safeMaterials.push(item);
    }
  }
  return { safeMaterials, skippedUnsafe };
}
