import { z } from "zod";

/** YYYY-Www e.g. "2026-W45" */
export const ISO_WEEK_RE = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/;

/**
 * Validates that an ISO week string has a valid year and week number,
 * verifying that week 53 only passes if the year actually has 53 ISO weeks.
 */
export function isValidIsoWeek(weekStr: string): boolean {
  if (!ISO_WEEK_RE.test(weekStr)) return false;
  const [yearStr, weekNumStr] = weekStr.split("-W");
  const year = Number(yearStr);
  const week = Number(weekNumStr);
  if (week === 53) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Dow = jan4.getUTCDay() || 7;
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Dow - 1));
    const w53Thursday = new Date(week1Monday);
    w53Thursday.setUTCDate(week1Monday.getUTCDate() + 52 * 7 + 3);
    if (w53Thursday.getUTCFullYear() !== year) {
      return false;
    }
  }
  return true;
}

export const SummaryQuerySchema = z
  .object({
    week: z
      .string()
      .regex(ISO_WEEK_RE, "Must be a valid ISO week string in the format YYYY-Www (e.g. 2026-W45)")
      .refine(isValidIsoWeek, { message: "Specified week number does not exist in the given year" })
      .optional()
  })
  .strict();

export function toErrorDetails(error: z.ZodError): { field: string; issue: string }[] {
  return error.issues.flatMap((i) => {
    if (i.code === "unrecognized_keys" && i.path.length === 0) {
      return i.keys.map((k) => ({ field: k, issue: "Unknown field" }));
    }
    return [{ field: i.path.join(".") || "body", issue: i.message }];
  });
}
