import { z } from "zod";
import { AgeBandSchema } from "../catalog/types.js";

const Nickname = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(50));
const BirthMonthYear = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

const shape = {
  nickname: Nickname,
  birthMonthYear: BirthMonthYear,
  ageBand: AgeBandSchema
};

const bothSources = (v: { birthMonthYear?: string; ageBand?: string }) =>
  v.birthMonthYear === undefined || v.ageBand === undefined;
const BOTH_MSG = "Provide only one of birthMonthYear or ageBand";

// Contract: create takes a nickname plus exactly one age source.
export const CreateChildSchema = z
  .object({ nickname: shape.nickname, birthMonthYear: shape.birthMonthYear.optional(), ageBand: shape.ageBand.optional() })
  .strict()
  .refine((v) => (v.birthMonthYear === undefined) !== (v.ageBand === undefined), {
    message: "Provide exactly one of birthMonthYear or ageBand",
    path: ["birthMonthYear"]
  });

export const UpdateChildSchema = z
  .object({ nickname: shape.nickname.optional(), birthMonthYear: shape.birthMonthYear.optional(), ageBand: shape.ageBand.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" })
  .refine(bothSources, { message: BOTH_MSG, path: ["birthMonthYear"] });

export type CreateChildInput = z.infer<typeof CreateChildSchema>;
export type UpdateChildInput = z.infer<typeof UpdateChildSchema>;

/** Maps Zod issues to ErrorEnvelope details. */
export function toErrorDetails(error: z.ZodError): { field: string; issue: string }[] {
  return error.issues.map((i) => ({ field: i.path.join("."), issue: i.message }));
}
