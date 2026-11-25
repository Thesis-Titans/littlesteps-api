import type { AgeBand } from "../catalog/types.js";

const MAX_MATERIAL_LENGTH = 40;

const ALWAYS_HAZARDOUS_PATTERN =
  /\b(shampoo|conditioner|soap|detergent|bleach|cleaner|cleaning|disinfectant|sanitizer|alcohol|lotion|perfume|nail\s*polish|acetone|paint|glue|adhesive|chemical|pesticide|insecticide|medicine|pill|tablet|vitamin|knife|knives|scissor|scissors|blade|razor|needle|pins?|nail|screw|staple|glass|shard|lighter|match(?:stick)?s?|candle|fire|flame|stove|boiling|hot\s*water|iron|battery|batteries|charger|wire|cord|outlet|plastic\s*(?:grocery\s*)?bags?|strings?|ropes?)\b/i;

const TODDLER_CHOKING_PATTERN =
  /\b(coins?|marbles?|buttons?|beads?|pebbles?|stones?|rocks?|magnets?|balloons?|popcorn|grapes?|peanuts?|nuts?|seeds?|raw\s*carrots?|bottle\s*caps?|small\s*caps?)\b/i;

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

/** Returns true if [text] references an item that is unsafe for [ageBand]. */
export function containsHazardousMaterial(text: string, ageBand: AgeBand): boolean {
  if (ALWAYS_HAZARDOUS_PATTERN.test(text)) return true;
  if (TODDLER_BANDS.has(ageBand) && TODDLER_CHOKING_PATTERN.test(text)) return true;
  return false;
}

/** Partitions cleaned materials into safe items vs. items skipped for pediatric safety or prompt hygiene. */
export function screenMaterialsForSafety(
  materials: string[],
  ageBand: AgeBand
): { safeMaterials: string[]; skippedUnsafe: string[] } {
  const safeMaterials: string[] = [];
  const skippedUnsafe: string[] = [];
  for (const item of materials) {
    if (item === "none" || item === "no materials") continue;
    if (containsHazardousMaterial(item, ageBand)) {
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
