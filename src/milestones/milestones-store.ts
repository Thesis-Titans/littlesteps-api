import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { stripUndefined } from "../strip-undefined.js";
import type { MilestonesListFilter, StoredMilestoneObservation } from "./types.js";

export interface MilestonesStore {
  list(uid: string, childId: string, filter?: MilestonesListFilter): Promise<StoredMilestoneObservation[]>;
  get(uid: string, childId: string, idOrMilestoneId: string): Promise<StoredMilestoneObservation | null>;
  create(uid: string, childId: string, observation: StoredMilestoneObservation): Promise<boolean>;
  update(
    uid: string,
    childId: string,
    idOrMilestoneId: string,
    fn: (current: StoredMilestoneObservation) => StoredMilestoneObservation
  ): Promise<StoredMilestoneObservation | null>;
}

const ownedBy = (
  uid: string,
  childId: string,
  obs: StoredMilestoneObservation | undefined
): StoredMilestoneObservation | null =>
  obs && obs.caregiverId === uid && obs.childId === childId ? obs : null;

export const MILESTONES_LIST_LIMIT = 100;

export function createFirestoreMilestonesStore(): MilestonesStore {
  if (getApps().length === 0) initializeApp();
  const col = (uid: string, childId: string) =>
    getFirestore()
      .collection("caregivers")
      .doc(uid)
      .collection("children")
      .doc(childId)
      .collection("milestone_observations");

  return {
    async list(uid, childId, filter) {
      let query: FirebaseFirestore.Query = col(uid, childId);
      if (filter?.status) {
        query = query.where("status", "==", filter.status);
      }
      if (filter?.milestoneId) {
        query = query.where("milestoneId", "==", filter.milestoneId);
      }
      const snap = await query.orderBy("observedDate").orderBy(FieldPath.documentId()).limit(MILESTONES_LIST_LIMIT).get();
      return snap.docs
        .map((d) => ownedBy(uid, childId, d.data() as StoredMilestoneObservation))
        .filter((o): o is StoredMilestoneObservation => o !== null);
    },
    async get(uid, childId, idOrMilestoneId) {
      const byId = await col(uid, childId).doc(idOrMilestoneId).get();
      if (byId.exists) {
        return ownedBy(uid, childId, byId.data() as StoredMilestoneObservation);
      }
      const byMilestone = await col(uid, childId).where("milestoneId", "==", idOrMilestoneId).limit(1).get();
      if (!byMilestone.empty) {
        return ownedBy(uid, childId, byMilestone.docs[0].data() as StoredMilestoneObservation);
      }
      return null;
    },
    async create(uid, childId, observation) {
      await col(uid, childId).doc(observation.id).set(stripUndefined(observation));
      return true;
    },
    async update(uid, childId, idOrMilestoneId, fn) {
      return getFirestore().runTransaction(async (tx) => {
        let docRef = col(uid, childId).doc(idOrMilestoneId);
        let snap = await tx.get(docRef);
        if (!snap.exists) {
          const byMilestone = await tx.get(col(uid, childId).where("milestoneId", "==", idOrMilestoneId).limit(1));
          if (byMilestone.empty) return null;
          docRef = byMilestone.docs[0].ref;
          snap = byMilestone.docs[0];
        }
        const current = ownedBy(uid, childId, snap.data() as StoredMilestoneObservation);
        if (!current) return null;
        const next = fn(current);
        tx.set(docRef, stripUndefined(next)); // set replaces the doc, so cleared fields are removed
        return next;
      });
    }
  };
}

export function createMemoryMilestonesStore(): MilestonesStore & { data: Map<string, StoredMilestoneObservation> } {
  const data = new Map<string, StoredMilestoneObservation>(); // key: `${uid}/${childId}/${obs.id}`

  return {
    data,
    async list(uid, childId, filter) {
      return [...data.entries()]
        .filter(([k]) => k.startsWith(`${uid}/${childId}/`))
        .map(([, v]) => ownedBy(uid, childId, v))
        .filter((o): o is StoredMilestoneObservation => o !== null)
        .filter((o) => (filter?.status ? o.status === filter.status : true))
        .filter((o) => (filter?.milestoneId ? o.milestoneId === filter.milestoneId : true))
        .sort((a, b) =>
          a.observedDate.localeCompare(b.observedDate) ||
          a.id.localeCompare(b.id)
        )
        .slice(0, MILESTONES_LIST_LIMIT);
    },
    async get(uid, childId, idOrMilestoneId) {
      for (const [k, v] of data.entries()) {
        if (k.startsWith(`${uid}/${childId}/`) && (v.id === idOrMilestoneId || v.milestoneId === idOrMilestoneId)) {
          return ownedBy(uid, childId, v);
        }
      }
      return null;
    },
    async create(uid, childId, observation) {
      data.set(`${uid}/${childId}/${observation.id}`, { ...observation });
      return true;
    },
    async update(uid, childId, idOrMilestoneId, fn) {
      let foundKey: string | null = null;
      let current: StoredMilestoneObservation | null = null;
      for (const [k, v] of data.entries()) {
        if (k.startsWith(`${uid}/${childId}/`) && (v.id === idOrMilestoneId || v.milestoneId === idOrMilestoneId)) {
          foundKey = k;
          current = ownedBy(uid, childId, v);
          break;
        }
      }
      if (!foundKey || !current) return null;
      const next = fn(current);
      data.set(foundKey, { ...next });
      return next;
    }
  };
}
