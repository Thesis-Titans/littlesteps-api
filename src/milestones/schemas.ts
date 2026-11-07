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

export const MilestoneStatusSchema = z.enum(["observed", "not_yet_observed", "not_sure"]);

export const MilestoneIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "Must be a valid milestone identifier");

export const ObservedDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Must be in YYYY-MM-DD format")
  .refine(isValidCalendarDate, "Must be a valid calendar date");

export const NotesSchema = z
  .string()
  .max(500)
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s), "Notes must not contain control or invisible characters");

export const CreateMilestoneObservationSchema = z
  .object({
    milestoneId: MilestoneIdSchema,
    status: MilestoneStatusSchema,
    observedDate: ObservedDateSchema.optional(),
    notes: NotesSchema.optional()
  })
  .strict();

export const UpdateMilestoneObservationSchema = z
  .object({
    status: MilestoneStatusSchema.optional(),
    observedDate: ObservedDateSchema.optional(),
    notes: NotesSchema.optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

export const MilestonesQuerySchema = z
  .object({
    status: MilestoneStatusSchema.optional(),
    milestoneId: MilestoneIdSchema.optional()
  })
  .strict();

export type CreateMilestoneObservationInput = z.infer<typeof CreateMilestoneObservationSchema>;
export type UpdateMilestoneObservationInput = z.infer<typeof UpdateMilestoneObservationSchema>;

export function toErrorDetails(error: z.ZodError): { field: string; issue: string }[] {
  return error.issues.flatMap((i) => {
    if (i.code === "unrecognized_keys" && i.path.length === 0) {
      return i.keys.map((k) => ({ field: k, issue: "Unknown field" }));
    }
    return [{ field: i.path.join(".") || "body", issue: i.message }];
  });
}
