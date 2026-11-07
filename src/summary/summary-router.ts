import { Router, type Request, type Response } from "express";
import { getChildrenStore } from "../children/children-router.js";
import { getPlansStore } from "../activities/activities-router.js";
import { getMilestonesStore } from "../milestones/milestones-router.js";
import { SummaryQuerySchema, toErrorDetails } from "./schemas.js";
import {
  computeWeeklySummary,
  currentIsoWeek,
  isoWeekBounds
} from "./summary-service.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const notFound = (response: Response) =>
  response.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });

const invalid = (response: Response, details: { field: string; issue: string }[]) =>
  response.status(400).json({ error: { code: "INVALID_INPUT", message: "Request fields are invalid", details } });

const uidOf = (request: Request) => request.firebaseUser!.uid;

const childIdOf = (request: Request): string | null => {
  const id = request.params.childId;
  return typeof id === "string" && UUID_V4.test(id) ? id : null;
};

const summaryRouter = Router({ mergeParams: true });

summaryRouter.get("/weekly", async (request, response) => {
  const childId = childIdOf(request);
  if (!childId) return void notFound(response);

  const parsed = SummaryQuerySchema.safeParse(request.query);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));

  const child = await getChildrenStore().get(uidOf(request), childId);
  if (!child) return void notFound(response);

  const now = new Date();
  const weekId = parsed.data.week ?? currentIsoWeek(now);
  const bounds = isoWeekBounds(weekId);

  const plans = await getPlansStore().list(uidOf(request), childId);
  const milestones = await getMilestonesStore().list(uidOf(request), childId);

  const summary = computeWeeklySummary(
    plans,
    milestones,
    bounds.weekStart,
    bounds.weekEnd,
    weekId,
    now
  );

  response.status(200).json(summary);
});

export { summaryRouter };

