import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getChildrenStore } from "../children/children-router.js";
import {
  CreateJournalEntrySchema,
  JournalQuerySchema,
  UpdateJournalEntrySchema,
  isFutureDate,
  toErrorDetails
} from "./schemas.js";
import {
  createFirestoreJournalStore,
  type JournalStore
} from "./journal-store.js";
import type { PublicJournalEntry, StoredJournalEntry } from "./types.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let store: JournalStore | undefined;

export function setJournalStore(next: JournalStore | undefined): void {
  store = next;
}

export const getJournalStore = (): JournalStore => (store ??= createFirestoreJournalStore());

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

const entryIdOf = (request: Request): string | null => {
  const id = request.params.entryId;
  return typeof id === "string" && UUID_V4.test(id) ? id : null;
};

function toPublic(entry: StoredJournalEntry): PublicJournalEntry {
  const { caregiverId: _, ...rest } = entry;
  return rest;
}

const journalRouter = Router({ mergeParams: true });

journalRouter.get("/", async (request, response) => {
  const parsed = JournalQuerySchema.safeParse(request.query);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const entries = await getJournalStore().list(uidOf(request), childId, parsed.data);
  response.status(200).json(entries.map(toPublic));
});

journalRouter.post("/", async (request, response) => {
  const parsed = CreateJournalEntrySchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  if (isFutureDate(parsed.data.entryDate)) {
    return void invalid(response, [
      { field: "entryDate", issue: "Observation date cannot be in the future" }
    ]);
  }

  const now = new Date();
  const entry: StoredJournalEntry = {
    id: randomUUID(),
    childId,
    caregiverId: uidOf(request),
    entryDate: parsed.data.entryDate,
    content: parsed.data.content,
    linkedMilestoneId: parsed.data.linkedMilestoneId,
    linkedActivityId: parsed.data.linkedActivityId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  try {
    await getJournalStore().create(uidOf(request), childId, entry);
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  // Strictly avoid logging content or child identifiers per NFR-PRIV-02
  response.status(201).json(toPublic(entry));
});

journalRouter.get("/:entryId", async (request, response) => {
  const childId = childIdOf(request);
  const entryId = entryIdOf(request);
  if (!childId || !entryId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const entry = await getJournalStore().get(uidOf(request), childId, entryId);
  if (!entry) return void notFound(response);

  response.status(200).json(toPublic(entry));
});

journalRouter.patch("/:entryId", async (request, response) => {
  const parsed = UpdateJournalEntrySchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  const entryId = entryIdOf(request);
  if (!childId || !entryId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  if (parsed.data.entryDate && isFutureDate(parsed.data.entryDate)) {
    return void invalid(response, [
      { field: "entryDate", issue: "Observation date cannot be in the future" }
    ]);
  }

  const now = new Date();
  let updated: StoredJournalEntry | null;
  try {
    updated = await getJournalStore().update(uidOf(request), childId, entryId, (current) => ({
      ...current,
      ...(parsed.data.entryDate ? { entryDate: parsed.data.entryDate } : {}),
      ...(parsed.data.content ? { content: parsed.data.content } : {}),
      ...(parsed.data.linkedMilestoneId !== undefined
        ? { linkedMilestoneId: parsed.data.linkedMilestoneId }
        : {}),
      ...(parsed.data.linkedActivityId !== undefined
        ? { linkedActivityId: parsed.data.linkedActivityId }
        : {}),
      updatedAt: now.toISOString()
    }));
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  if (!updated) return void notFound(response);
  response.status(200).json(toPublic(updated));
});

journalRouter.delete("/:entryId", async (request, response) => {
  const childId = childIdOf(request);
  const entryId = entryIdOf(request);
  if (!childId || !entryId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  let deleted: boolean;
  try {
    deleted = await getJournalStore().delete(uidOf(request), childId, entryId);
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  if (!deleted) return void notFound(response);
  response.status(204).end();
});

export { journalRouter };
