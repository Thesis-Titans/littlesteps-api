import { z } from "zod";

export const AgeBandSchema = z.enum([
  "0-5m",
  "6-11m",
  "12-23m",
  "24-35m",
  "36-47m",
  "48-59m",
  "60-71m"
]);
export type AgeBand = z.infer<typeof AgeBandSchema>;

export const ActivityTypeSchema = z.enum(["activity", "story", "rhyme", "game"]);
export type ActivityType = z.infer<typeof ActivityTypeSchema>;

export const DomainSchema = z.enum(["cognitive", "motor", "language", "socioEmotional"]);
export type Domain = z.infer<typeof DomainSchema>;

export const LanguageSchema = z.enum(["en", "fil", "hil"]);
export type Language = z.infer<typeof LanguageSchema>;

export const SettingSchema = z.enum(["indoor", "outdoor", "either"]);
export type Setting = z.infer<typeof SettingSchema>;

export const ReviewStatusSchema = z.enum(["reviewed_approved", "synthetic_fixture", "draft"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const CatalogActivitySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  type: ActivityTypeSchema,
  language: LanguageSchema,
  setting: SettingSchema,
  ageBand: AgeBandSchema,
  domain: DomainSchema,
  durationMinutes: z.number().int().min(1).max(180),
  durationEstimate: z.string().min(1),
  materials: z.array(z.string()),
  instructions: z.array(z.string()).min(1),
  provenanceSource: z.string().min(1),
  status: ReviewStatusSchema,
  limitations: z.string().min(1)
});
export type CatalogActivity = z.infer<typeof CatalogActivitySchema>;

export const CatalogActivitiesQuerySchema = z.object({
  ageBand: AgeBandSchema.optional(),
  type: ActivityTypeSchema.optional(),
  domain: DomainSchema.optional(),
  language: LanguageSchema.optional(),
  setting: SettingSchema.optional(),
  limit: z.preprocess(
    (value) => (value !== undefined ? Number(value) : 20),
    z.number().int().min(1).max(50)
  ).default(20)
});
export type CatalogActivitiesQuery = z.infer<typeof CatalogActivitiesQuerySchema>;

export const BookItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  coverUrl: z.string().nullable(),
  subjects: z.array(z.string())
});
export type BookItem = z.infer<typeof BookItemSchema>;

export const BooksResponseSchema = z.object({
  subject: z.string(),
  totalCount: z.number().int(),
  books: z.array(BookItemSchema),
  provenance: z.object({
    source: z.string(),
    license: z.string().optional()
  })
});
export type BooksResponse = z.infer<typeof BooksResponseSchema>;

export const BooksQuerySchema = z.object({
  subject: z.string().trim().min(1).default("picture_books").optional(),
  limit: z.preprocess(
    (value) => (value !== undefined ? Number(value) : 12),
    z.number().int().min(1).max(30)
  ).default(12)
});
export type BooksQuery = z.infer<typeof BooksQuerySchema>;
