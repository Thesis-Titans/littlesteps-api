import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { AgeRangeError, assertBirthMonthInRange } from "./age.js";
import { createFirestoreChildrenStore, type ChildrenStore } from "./children-store.js";
import { applyUpdate, toPublic, toStored } from "./mapping.js";
import { CreateChildSchema, UpdateChildSchema, toErrorDetails } from "./schemas.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let store: ChildrenStore | undefined;
/** Tests inject an in-memory store; production creates the Firestore one on first use. */
export function setChildrenStore(next: ChildrenStore | undefined): void {
  store = next;
}
const getStore = () => (store ??= createFirestoreChildrenStore());

const notFound = (response: Response) =>
  response.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });

const invalid = (response: Response, details: { field: string; issue: string }[]) =>
  response.status(400).json({ error: { code: "INVALID_INPUT", message: "Request fields are invalid", details } });

function rangeCheck(response: Response, birth: string | undefined, now: Date): boolean {
  if (birth === undefined) return true;
  try {
    assertBirthMonthInRange(birth, now);
    return true;
  } catch (error) {
    if (!(error instanceof AgeRangeError)) throw error;
    response.status(422).json({
      error: {
        code: "UNPROCESSABLE_ENTITY",
        message: error.message,
        details: [{ field: "birthMonthYear", issue: "Must not be in the future or older than 71 months" }]
      }
    });
    return false;
  }
}

const childrenRouter = Router();
// uid comes only from the verified token set by requireFirebaseUser.
const uidOf = (request: Request) => request.firebaseUser!.uid;
const idOf = (request: Request): string | null => {
  const id = request.params.childId;
  return typeof id === "string" && UUID_V4.test(id) ? id : null;
};

childrenRouter.get("/", async (request, response) => {
  const now = new Date();
  const children = await getStore().list(uidOf(request));
  children.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  response.status(200).json(children.map((c) => toPublic(c, now)));
});

childrenRouter.post("/", async (request, response) => {
  const parsed = CreateChildSchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));
  const now = new Date();
  if (!rangeCheck(response, parsed.data.birthMonthYear, now)) return;
  const child = toStored(parsed.data, uidOf(request), randomUUID(), now);
  await getStore().create(uidOf(request), child);
  response.status(201).json(toPublic(child, now));
});

childrenRouter.get("/:childId", async (request, response) => {
  const id = idOf(request);
  const child = id && (await getStore().get(uidOf(request), id));
  if (!child) return void notFound(response);
  response.status(200).json(toPublic(child, new Date()));
});

childrenRouter.patch("/:childId", async (request, response) => {
  const parsed = UpdateChildSchema.safeParse(request.body);
  if (!parsed.success) return void invalid(response, toErrorDetails(parsed.error));
  const id = idOf(request);
  const now = new Date();
  if (!rangeCheck(response, parsed.data.birthMonthYear, now)) return;
  const current = id && (await getStore().get(uidOf(request), id));
  if (!current) return void notFound(response);
  const next = applyUpdate(current, parsed.data, now);
  await getStore().replace(uidOf(request), next);
  response.status(200).json(toPublic(next, now));
});

export { childrenRouter };
