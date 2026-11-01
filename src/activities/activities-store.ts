import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import type { PlansListFilter, StoredPlan } from "./types.js";

export interface PlansStore {
  list(uid: string, childId: string, filter?: PlansListFilter): Promise<StoredPlan[]>;
  get(uid: string, childId: string, planId: string): Promise<StoredPlan | null>;
  create(uid: string, childId: string, plan: StoredPlan): Promise<boolean>;
  update(uid: string, childId: string, planId: string, fn: (current: StoredPlan) => StoredPlan): Promise<StoredPlan | null>;
  delete(uid: string, childId: string, planId: string): Promise<boolean>;
}

const ownedBy = (uid: string, childId: string, plan: StoredPlan | undefined): StoredPlan | null =>
  plan && plan.caregiverId === uid && plan.childId === childId ? plan : null;

export const PLANS_LIST_LIMIT = 100;

export function createFirestorePlansStore(): PlansStore {
  if (getApps().length === 0) initializeApp();
  const col = (uid: string, childId: string) =>
    getFirestore()
      .collection("caregivers")
      .doc(uid)
      .collection("children")
      .doc(childId)
      .collection("plans");

  return {
    async list(uid, childId, filter) {
      let query: FirebaseFirestore.Query = col(uid, childId);
      if (filter?.date) {
        query = query.where("scheduledDate", "==", filter.date);
      }
      if (filter?.status) {
        query = query.where("status", "==", filter.status);
      }
      const snap = await query.orderBy("scheduledDate").orderBy(FieldPath.documentId()).limit(PLANS_LIST_LIMIT).get();
      return snap.docs
        .map((d) => ownedBy(uid, childId, d.data() as StoredPlan))
        .filter((p): p is StoredPlan => p !== null);
    },
    async get(uid, childId, planId) {
      const snap = await col(uid, childId).doc(planId).get();
      return snap.exists ? ownedBy(uid, childId, snap.data() as StoredPlan) : null;
    },
    async create(uid, childId, plan) {
      await col(uid, childId).doc(plan.id).set(plan);
      return true;
    },
    async update(uid, childId, planId, fn) {
      const ref = col(uid, childId).doc(planId);
      return getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? ownedBy(uid, childId, snap.data() as StoredPlan) : null;
        if (!current) return null;
        const next = fn(current);
        tx.update(ref, { ...next });
        return next;
      });
    },
    async delete(uid, childId, planId) {
      const ref = col(uid, childId).doc(planId);
      return getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? ownedBy(uid, childId, snap.data() as StoredPlan) : null;
        if (!current) return false;
        tx.delete(ref);
        return true;
      });
    }
  };
}

export function createMemoryPlansStore(): PlansStore & { data: Map<string, StoredPlan> } {
  const data = new Map<string, StoredPlan>(); // key: `${uid}/${childId}/${planId}`

  return {
    data,
    async list(uid, childId, filter) {
      return [...data.entries()]
        .filter(([k]) => k.startsWith(`${uid}/${childId}/`))
        .map(([, v]) => ownedBy(uid, childId, v))
        .filter((p): p is StoredPlan => p !== null)
        .filter((p) => (filter?.date ? p.scheduledDate === filter.date : true))
        .filter((p) => (filter?.status ? p.status === filter.status : true))
        .sort((a, b) =>
          a.scheduledDate.localeCompare(b.scheduledDate) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id)
        )
        .slice(0, PLANS_LIST_LIMIT);
    },
    async get(uid, childId, planId) {
      return ownedBy(uid, childId, data.get(`${uid}/${childId}/${planId}`));
    },
    async create(uid, childId, plan) {
      data.set(`${uid}/${childId}/${plan.id}`, { ...plan });
      return true;
    },
    async update(uid, childId, planId, fn) {
      const current = ownedBy(uid, childId, data.get(`${uid}/${childId}/${planId}`));
      if (!current) return null;
      const next = fn(current);
      data.set(`${uid}/${childId}/${planId}`, { ...next });
      return next;
    },
    async delete(uid, childId, planId) {
      const current = ownedBy(uid, childId, data.get(`${uid}/${childId}/${planId}`));
      if (!current) return false;
      data.delete(`${uid}/${childId}/${planId}`);
      return true;
    }
  };
}
