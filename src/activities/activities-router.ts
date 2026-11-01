import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { getChildrenStore } from "../children/children-router.js";
import {
  CreatePlanSchema,
  PlansQuerySchema,
  UpdatePlanSchema,
  toErrorDetails
} from "./schemas.js";
import {
  createFirestorePlansStore,
  type PlansStore
} from "./activities-store.js";
import type { PublicPlan, StoredPlan } from "./types.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let store: PlansStore | undefined;

export function setPlansStore(next: PlansStore | undefined): void {
  store = next;
}

export const getPlansStore = (): PlansStore => (store ??= createFirestorePlansStore());

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

const planIdOf = (request: Request): string | null => {
  const id = request.params.planId;
  return typeof id === "string" && UUID_V4.test(id) ? id : null;
};

function toPublic(plan: StoredPlan): PublicPlan {
  const { caregiverId: _, ...rest } = plan;
  return rest;
}

const activitiesRouter = Router({ mergeParams: true });

activitiesRouter.get("/", async (request, response) => {
  const parsed = PlansQuerySchema.safeParse(request.query);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const plans = await getPlansStore().list(uidOf(request), childId, parsed.data);
  response.status(200).json(plans.map(toPublic));
});

activitiesRouter.post("/", async (request, response) => {
  const parsed = CreatePlanSchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const now = new Date();
  const status = parsed.data.status ?? "planned";
  const completedAt = status === "completed" ? now.toISOString() : undefined;

  const plan: StoredPlan = {
    id: randomUUID(),
    childId,
    caregiverId: uidOf(request),
    activityId: parsed.data.activityId,
    scheduledDate: parsed.data.scheduledDate,
    status,
    completedAt,
    durationMinutes: parsed.data.durationMinutes,
    feedbackNote: parsed.data.feedbackNote,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  try {
    await getPlansStore().create(uidOf(request), childId, plan);
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  response.status(201).json(toPublic(plan));
});

activitiesRouter.patch("/:planId", async (request, response) => {
  const parsed = UpdatePlanSchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const planId = planIdOf(request);
  if (!planId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const now = new Date();
  let next: StoredPlan | null;
  try {
    next = await getPlansStore().update(uidOf(request), childId, planId, (current) => {
      const status = parsed.data.status ?? current.status;
      let completedAt = current.completedAt;
      if (parsed.data.status === "completed" && current.status !== "completed") {
        completedAt = now.toISOString();
      } else if (parsed.data.status && parsed.data.status !== "completed") {
        completedAt = undefined;
      }

      return {
        ...current,
        activityId: parsed.data.activityId ?? current.activityId,
        scheduledDate: parsed.data.scheduledDate ?? current.scheduledDate,
        status,
        completedAt,
        durationMinutes: parsed.data.durationMinutes !== undefined ? parsed.data.durationMinutes : current.durationMinutes,
        feedbackNote: parsed.data.feedbackNote !== undefined ? parsed.data.feedbackNote : current.feedbackNote,
        updatedAt: now.toISOString()
      };
    });
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  if (!next) return void notFound(response);
  response.status(200).json(toPublic(next));
});

activitiesRouter.delete("/:planId", async (request, response) => {
  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const planId = planIdOf(request);
  if (!planId) return void notFound(response);

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  let deleted: boolean;
  try {
    deleted = await getPlansStore().delete(uidOf(request), childId, planId);
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  if (!deleted) return void notFound(response);
  response.status(204).end();
});

export { activitiesRouter };
