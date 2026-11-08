import { getAuth } from "firebase-admin/auth";
import { Router, type Request, type Response } from "express";
import { getPlansStore } from "../activities/activities-router.js";
import type { PublicPlan, StoredPlan } from "../activities/types.js";
import { getChildrenStore } from "../children/children-router.js";
import { toPublic as toPublicChild } from "../children/mapping.js";
import { getMilestonesStore } from "../milestones/milestones-router.js";
import type { PublicMilestoneObservation, StoredMilestoneObservation } from "../milestones/types.js";
import {
  createFirestoreCaregiversStore,
  type CaregiversStore
} from "./account-store.js";
import {
  getJournalStore,
  setJournalStore
} from "../journal/journal-router.js";
export { getJournalStore, setJournalStore };
import type {
  AccountExport,
  PublicCaregiverProfile,
  PublicJournalEntry,
  StoredJournalEntry
} from "./types.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let caregiversStore: CaregiversStore | undefined;

export type AuthUserDeleter = (uid: string) => Promise<void>;
let authUserDeleter: AuthUserDeleter | undefined;

export function setCaregiversStore(next: CaregiversStore | undefined): void {
  caregiversStore = next;
}
export const getCaregiversStore = (): CaregiversStore => (caregiversStore ??= createFirestoreCaregiversStore());

export function setAuthUserDeleter(next: AuthUserDeleter | undefined): void {
  authUserDeleter = next;
}

const defaultAuthUserDeleter: AuthUserDeleter = async (uid: string) => {
  const auth = getAuth() as { deleteUser?: (u: string) => Promise<void> };
  if (typeof auth.deleteUser === "function") {
    try {
      await auth.deleteUser(uid);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== "auth/user-not-found") {
        throw error;
      }
    }
  }
};

export const getAuthUserDeleter = (): AuthUserDeleter => authUserDeleter ?? defaultAuthUserDeleter;

/** Deletes an owned child and cascades to child-scoped subcollections; returns false if missing or not owned. */
export async function deleteChildWithRecords(uid: string, childId: string): Promise<boolean> {
  const deleted = await getChildrenStore().delete(uid, childId);
  if (!deleted) return false;
  await getPlansStore().deleteAllForChild?.(uid, childId);
  await getMilestonesStore().deleteAllForChild?.(uid, childId);
  await getJournalStore().deleteAllForChild?.(uid, childId);
  return true;
}

const notFound = (response: Response) =>
  response.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Resource not found" } });

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

function toPublicPlan(plan: StoredPlan): PublicPlan {
  const { caregiverId: _, ...rest } = plan;
  return rest;
}

function toPublicObservation(obs: StoredMilestoneObservation): PublicMilestoneObservation {
  const { caregiverId: _, ...rest } = obs;
  return rest;
}

function toPublicJournalEntry(entry: StoredJournalEntry): PublicJournalEntry {
  const { caregiverId: _, ...rest } = entry;
  return rest;
}

async function isCrossAccountAttempt(request: Request, uid: string): Promise<boolean> {
  const queryUid = request.query.uid;
  if (queryUid !== undefined && queryUid !== uid) return true;

  const queryCaregiverId = request.query.caregiverId;
  if (queryCaregiverId !== undefined && queryCaregiverId !== uid) return true;

  const body = request.body as Record<string, unknown> | undefined;
  if (body && typeof body === "object") {
    if (body.uid !== undefined && body.uid !== uid) return true;
    if (body.caregiverId !== undefined && body.caregiverId !== uid) return true;
  }

  const queryChildId = request.query.childId;
  if (queryChildId !== undefined) {
    if (typeof queryChildId !== "string" || !UUID_V4.test(queryChildId)) return true;
    const owned = await getChildrenStore().get(uid, queryChildId);
    if (!owned) return true;
  }

  return false;
}

const accountRouter = Router();

accountRouter.get("/", (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json({ uid: uidOf(request) });
});

accountRouter.get("/export", async (request, response) => {
  const uid = uidOf(request);
  if (await isCrossAccountAttempt(request, uid)) {
    return void notFound(response);
  }

  const now = new Date();
  const storedProfile = await getCaregiversStore().getProfile(uid);
  const tokenEmail = request.firebaseUser?.email;
  const email = storedProfile?.email ?? (typeof tokenEmail === "string" ? tokenEmail : undefined);

  const profile: PublicCaregiverProfile = {
    uid,
    ...(email ? { email } : {}),
    ...(storedProfile?.displayName ? { displayName: storedProfile.displayName } : {}),
    ...(storedProfile?.weatherLocation ? { weatherLocation: storedProfile.weatherLocation } : {}),
    ...(storedProfile?.createdAt ? { createdAt: storedProfile.createdAt } : {}),
    ...(storedProfile?.updatedAt ? { updatedAt: storedProfile.updatedAt } : {})
  };

  const storedChildren = await getChildrenStore().list(uid);
  storedChildren.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  const children = storedChildren.map((c) => toPublicChild(c, now));
  const plans: PublicPlan[] = [];
  const observations: PublicMilestoneObservation[] = [];
  const journalEntries: PublicJournalEntry[] = [];

  for (const child of storedChildren) {
    const [childPlans, childObs, childJournal] = await Promise.all([
      getPlansStore().list(uid, child.id),
      getMilestonesStore().list(uid, child.id),
      getJournalStore().list(uid, child.id)
    ]);
    plans.push(...childPlans.map(toPublicPlan));
    observations.push(...childObs.map(toPublicObservation));
    journalEntries.push(...childJournal.map(toPublicJournalEntry));
  }

  const payload: AccountExport = {
    exportedAt: now.toISOString(),
    profile,
    children,
    plans,
    observations,
    journalEntries
  };

  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(payload);
});

accountRouter.delete("/", async (request, response) => {
  const uid = uidOf(request);
  if (await isCrossAccountAttempt(request, uid)) {
    return void notFound(response);
  }

  try {
    const children = await getChildrenStore().list(uid);
    for (const child of children) {
      await deleteChildWithRecords(uid, child.id);
    }
    await getCaregiversStore().deleteCaregiver(uid);
    await getAuthUserDeleter()(uid);
  } catch (error) {
    if (!isAborted(error)) throw error;
    return void unavailable(response);
  }

  console.info(JSON.stringify({ event: "account.deleted", uid }));
  response.status(204).end();
});

export { accountRouter };

