import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getChildrenStore } from "../children/children-router.js";
import {
  CreateMilestoneObservationSchema,
  MilestonesQuerySchema,
  UpdateMilestoneObservationSchema,
  isFutureDate,
  toErrorDetails
} from "./schemas.js";
import {
  createFirestoreMilestonesStore,
  type MilestonesStore
} from "./milestones-store.js";
import type { PublicMilestoneObservation, StoredMilestoneObservation } from "./types.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MILESTONE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

let store: MilestonesStore | undefined;

export function setMilestonesStore(next: MilestonesStore | undefined): void {
  store = next;
}

export const getMilestonesStore = (): MilestonesStore => (store ??= createFirestoreMilestonesStore());

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

const milestoneIdOf = (request: Request): string | null => {
  const id = request.params.milestoneId;
  return typeof id === "string" && MILESTONE_ID_PATTERN.test(id) ? id : null;
};

function toPublic(obs: StoredMilestoneObservation): PublicMilestoneObservation {
  const { caregiverId: _, ...rest } = obs;
  return rest;
}

const milestonesRouter = Router({ mergeParams: true });

milestonesRouter.get("/", async (request, response) => {
  const parsed = MilestonesQuerySchema.safeParse(request.query);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const observations = await getMilestonesStore().list(uidOf(request), childId, parsed.data);
  response.status(200).json(observations.map(toPublic));
});

milestonesRouter.post("/", async (request, response) => {
  const parsed = CreateMilestoneObservationSchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const now = new Date();
  if (parsed.data.observedDate && isFutureDate(parsed.data.observedDate, now)) {
    return void response.status(422).json({
      error: {
        code: "UNPROCESSABLE_ENTITY",
        message: "Observation date cannot be in the future",
        details: [{ field: "observedDate", issue: "Must not be in the future" }]
      }
    });
  }

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const today = now.toISOString().slice(0, 10);
  const observation: StoredMilestoneObservation = {
    id: randomUUID(),
    childId,
    caregiverId: uidOf(request),
    milestoneId: parsed.data.milestoneId,
    status: parsed.data.status,
    observedDate: parsed.data.observedDate ?? today,
    notes: parsed.data.notes,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  try {
    await getMilestonesStore().create(uidOf(request), childId, observation);
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  response.status(201).json(toPublic(observation));
});

milestonesRouter.patch("/:milestoneId", async (request, response) => {
  const parsed = UpdateMilestoneObservationSchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const now = new Date();
  if (parsed.data.observedDate && isFutureDate(parsed.data.observedDate, now)) {
    return void response.status(422).json({
      error: {
        code: "UNPROCESSABLE_ENTITY",
        message: "Observation date cannot be in the future",
        details: [{ field: "observedDate", issue: "Must not be in the future" }]
      }
    });
  }

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const milestoneId = milestoneIdOf(request);
  if (!milestoneId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  let next: StoredMilestoneObservation | null;
  try {
    next = await getMilestonesStore().update(uidOf(request), childId, milestoneId, (current) => ({
      ...current,
      status: parsed.data.status ?? current.status,
      observedDate: parsed.data.observedDate ?? current.observedDate,
      notes: parsed.data.notes !== undefined ? parsed.data.notes : current.notes,
      updatedAt: now.toISOString()
    }));
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  if (!next) return void notFound(response);
  response.status(200).json(toPublic(next));
});

export { milestonesRouter };
