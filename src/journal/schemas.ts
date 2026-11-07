import { z } from "zod";

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function isFutureDate(dateStr: string, now: Date = new Date()): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const dateUtc = Date.UTC(year, month - 1, day);
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return dateUtc > todayUtc;
}

// Forbid control characters except standard whitespace (\r, \n, \t) and forbid format characters (\p{Cf})
const FORBIDDEN_CONTROL_CHARS = /[^\P{Cc}\r\n\t]|[\p{Cf}]/u;

export const EntryDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Must be in YYYY-MM-DD format")
  .refine(isValidCalendarDate, "Must be a valid calendar date");

export const ContentSchema = z
  .string()
  .min(1, "Journal note content cannot be empty")
  .max(2000, "Notes can be up to 2,000 characters. Please make this one a little shorter.")
  .refine((s) => s.trim().length > 0, "Journal note content cannot be empty")
  .refine((s) => !FORBIDDEN_CONTROL_CHARS.test(s), "Notes must not contain control or invisible characters");

export const LinkedMilestoneIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "Must be a valid milestone identifier");

export const LinkedActivityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Must be a valid activity identifier");

export const CreateJournalEntrySchema = z
  .object({
    entryDate: EntryDateSchema,
    content: ContentSchema,
    linkedMilestoneId: LinkedMilestoneIdSchema.optional(),
    linkedActivityId: LinkedActivityIdSchema.optional()
  })
  .strict();

export const UpdateJournalEntrySchema = z
  .object({
    entryDate: EntryDateSchema.optional(),
    content: ContentSchema.optional(),
    linkedMilestoneId: LinkedMilestoneIdSchema.optional(),
    linkedActivityId: LinkedActivityIdSchema.optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

export const JournalQuerySchema = z
  .object({
    date: EntryDateSchema.optional()
  })
  .strict();

export type CreateJournalEntryInput = z.infer<typeof CreateJournalEntrySchema>;
export type UpdateJournalEntryInput = z.infer<typeof UpdateJournalEntrySchema>;

export function toErrorDetails(error: z.ZodError): { field: string; issue: string }[] {
  return error.issues.flatMap((i) => {
    if (i.code === "unrecognized_keys" && i.path.length === 0) {
      return i.keys.map((k) => ({ field: k, issue: "Unknown field" }));
    }
    return [{ field: i.path.join(".") || "body", issue: i.message }];
  });
}
