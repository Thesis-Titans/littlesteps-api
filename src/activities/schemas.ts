import { z } from "zod";

function isValidCalendarDate(dateStr: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export const PlanStatusSchema = z.enum(["planned", "completed", "skipped"]);

export const ActivityIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "Must be a valid lowercase kebab-case activity identifier");

export const ScheduledDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Must be in YYYY-MM-DD format")
  .refine(isValidCalendarDate, "Must be a valid calendar date");

export const DurationMinutesSchema = z.number().int().min(1).max(180);

export const FeedbackNoteSchema = z
  .string()
  .max(300)
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .refine((s) => !/[\p{Cc}\p{Cf}]/u.test(s), "Feedback note must not contain control or invisible characters");

const cleanText = (maxLen: number, label: string) =>
  z
    .string()
    .min(1)
    .max(maxLen)
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .refine((s) => s.length > 0 && !/[\p{Cc}\p{Cf}]/u.test(s), `${label} must not be empty or contain control characters`);

export const CustomPlanActivitySchema = z
  .object({
    title: cleanText(120, "Title"),
    domain: z.enum(["cognitive", "motor", "language", "socioEmotional"]),
    durationMinutes: DurationMinutesSchema,
    setting: z.enum(["indoor", "outdoor", "either"]),
    materials: z.array(cleanText(60, "Material")).max(10),
    instructions: z.array(cleanText(300, "Instruction")).min(1).max(6),
    safetyNotice: cleanText(200, "Safety notice").optional(),
    sourceLabel: cleanText(80, "Source label").optional()
  })
  .strict();

export const CreatePlanSchema = z
  .object({
    activityId: ActivityIdSchema,
    scheduledDate: ScheduledDateSchema,
    status: PlanStatusSchema.optional(),
    durationMinutes: DurationMinutesSchema.optional(),
    feedbackNote: FeedbackNoteSchema.optional(),
    customActivity: CustomPlanActivitySchema.optional()
  })
  .strict();

export const UpdatePlanSchema = z
  .object({
    activityId: ActivityIdSchema.optional(),
    scheduledDate: ScheduledDateSchema.optional(),
    status: PlanStatusSchema.optional(),
    durationMinutes: DurationMinutesSchema.optional(),
    feedbackNote: FeedbackNoteSchema.optional()
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

export const PlansQuerySchema = z
  .object({
    date: ScheduledDateSchema.optional(),
    status: PlanStatusSchema.optional()
  })
  .strict();

export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;
export type UpdatePlanInput = z.infer<typeof UpdatePlanSchema>;

export function toErrorDetails(error: z.ZodError): { field: string; issue: string }[] {
  return error.issues.flatMap((i) => {
    if (i.code === "unrecognized_keys" && i.path.length === 0) {
      return i.keys.map((k) => ({ field: k, issue: "Unknown field" }));
    }
    return [{ field: i.path.join(".") || "body", issue: i.message }];
  });
}
