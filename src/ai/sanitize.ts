const MAX_MATERIAL_LENGTH = 40;

/** Lowercases, trims, strips control and format characters, truncates, dedupes and drops empties. */
export function cleanMaterials(materials: string[]): string[] {
  const seen = new Set<string>();
  for (const raw of materials) {
    const cleaned = raw
      .replace(/[\p{Cc}\p{Cf}]/gu, "")
      .toLowerCase()
      .trim()
      .slice(0, MAX_MATERIAL_LENGTH)
      .trim();
    if (cleaned) seen.add(cleaned);
  }
  return [...seen];
}
