import { z } from "zod";

// Forbid control characters except standard whitespace and format characters
const FORBIDDEN_CONTROL_CHARS = /[^\P{Cc}\r\n\t]|[\p{Cf}]/u;

export const BookIdSchema = z
  .string()
  .min(1, "Book ID cannot be empty")
  .max(100, "Book ID is too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "Book ID must contain only alphanumeric characters, underscores, or dashes");

export const BookTitleSchema = z
  .string()
  .min(1, "Book title cannot be empty")
  .max(200, "Book title is too long")
  .refine((s) => s.trim().length > 0, "Book title cannot be whitespace")
  .refine((s) => !FORBIDDEN_CONTROL_CHARS.test(s), "Book title contains invalid characters");

export const BookAuthorSchema = z
  .string()
  .min(1, "Author name cannot be empty")
  .max(100, "Author name is too long")
  .refine((s) => !FORBIDDEN_CONTROL_CHARS.test(s), "Author name contains invalid characters");

export const BookSubjectSchema = z
  .string()
  .min(1)
  .max(50)
  .refine((s) => !FORBIDDEN_CONTROL_CHARS.test(s), "Subject contains invalid characters");

export const SaveBookSchema = z
  .object({
    id: BookIdSchema,
    title: BookTitleSchema,
    authors: z.array(BookAuthorSchema).default([]),
    coverUrl: z.string().url("Must be a valid URL").startsWith("https://", "Cover URL must use HTTPS").optional(),
    subjects: z.array(BookSubjectSchema).default([])
  })
  .strict();

export type SaveBookInput = z.infer<typeof SaveBookSchema>;

export function toErrorDetails(error: z.ZodError): { field: string; issue: string }[] {
  return error.issues.flatMap((i) => {
    if (i.code === "unrecognized_keys" && i.path.length === 0) {
      return i.keys.map((k) => ({ field: k, issue: "Unknown field" }));
    }
    return [{ field: i.path.join(".") || "body", issue: i.message }];
  });
}
