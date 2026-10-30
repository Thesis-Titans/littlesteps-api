const MAX_MATERIAL_LENGTH = 40;

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
