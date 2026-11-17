import { Router, type Request, type Response } from "express";
import { getChildrenStore } from "../children/children-router.js";
import { SaveBookSchema, BookIdSchema, toErrorDetails } from "./schemas.js";
import { createFirestoreBooksStore, type BooksStore } from "./books-store.js";
import type { PublicBook, StoredBook } from "./types.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let store: BooksStore | undefined;

export function setBooksStore(next: BooksStore | undefined): void {
  store = next;
}

export const getBooksStore = (): BooksStore => (store ??= createFirestoreBooksStore());

const notFound = (response: Response) =>
  response.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });

const invalid = (response: Response, details: { field: string; issue: string }[]) =>
  response.status(400).json({ error: { code: "INVALID_INPUT", message: "Request fields are invalid", details } });

const isAborted = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 10 || (typeof code === "string" && code.toLowerCase() === "aborted");
};

const unavailable = (response: Response) =>
  response
    .status(503)
    .set("Retry-After", "1")
    .json({ error: { code: "SERVICE_UNAVAILABLE", message: "Please try again in a moment." } });

const uidOf = (request: Request) => request.firebaseUser!.uid;

const childIdOf = (request: Request): string | null => {
  const id = request.params.childId;
  return typeof id === "string" && UUID_V4.test(id) ? id : null;
};

function toPublic(book: StoredBook): PublicBook {
  const { caregiverId: _, ...rest } = book;
  return rest;
}

export const booksRouter = Router({ mergeParams: true });

booksRouter.get("/", async (request, response) => {
  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const books = await getBooksStore().list(uidOf(request), childId);
  response.status(200).json({
    books: books.map(toPublic),
    totalCount: books.length
  });
});

booksRouter.post("/", async (request, response) => {
  const parsed = SaveBookSchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const existing = await getBooksStore().get(uidOf(request), childId, parsed.data.id);
  const now = new Date().toISOString();

  const book: StoredBook = {
    id: parsed.data.id,
    childId,
    caregiverId: uidOf(request),
    title: parsed.data.title,
    authors: parsed.data.authors,
    coverUrl: parsed.data.coverUrl,
    subjects: parsed.data.subjects,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  try {
    await getBooksStore().save(uidOf(request), childId, book);
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  response.status(201).json(toPublic(book));
});

booksRouter.delete("/:bookId", async (request, response) => {
  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const idParsed = BookIdSchema.safeParse(request.params.bookId);
  if (!idParsed.success) return void notFound(response);
  const bookId = idParsed.data;

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const deleted = await getBooksStore().delete(uidOf(request), childId, bookId);
  if (!deleted) return void notFound(response);

  response.status(204).send();
});
