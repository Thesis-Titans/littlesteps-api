import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { StoredChild } from "./types.js";

// Every method takes the verified uid; the storage path is derived from it only.
export interface ChildrenStore {
  list(uid: string): Promise<StoredChild[]>;
  get(uid: string, childId: string): Promise<StoredChild | null>;
  create(uid: string, child: StoredChild): Promise<void>;
  /** Atomic read-modify-write; returns null (and writes nothing) when missing or not owned. */
  update(uid: string, childId: string, fn: (current: StoredChild) => StoredChild): Promise<StoredChild | null>;
}

/** Stored caregiverId must equal the path uid; a mismatch is treated as missing. */
const ownedBy = (uid: string, child: StoredChild | undefined): StoredChild | null =>
  child && child.caregiverId === uid ? child : null;

/** Read cap for list; no per-caregiver creation cap is decided. */
export const LIST_LIMIT = 50;

export function createFirestoreChildrenStore(): ChildrenStore {
  if (getApps().length === 0) initializeApp();
  const col = (uid: string) => getFirestore().collection("caregivers").doc(uid).collection("children");
  return {
    async list(uid) {
      const snap = await col(uid).limit(LIST_LIMIT).get();
      return snap.docs.map((d) => ownedBy(uid, d.data() as StoredChild)).filter((c): c is StoredChild => c !== null);
    },
    async get(uid, childId) {
      const snap = await col(uid).doc(childId).get();
      return snap.exists ? ownedBy(uid, snap.data() as StoredChild) : null;
    },
    async create(uid, child) {
      await col(uid).doc(child.id).create(child);
    },
    async update(uid, childId, fn) {
      const ref = col(uid).doc(childId);
      return getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? ownedBy(uid, snap.data() as StoredChild) : null;
        if (!current) return null;
        const next = fn(current);
        tx.update(ref, { ...next });
        return next;
      });
    }
  };
}

export function createMemoryChildrenStore(): ChildrenStore & { data: Map<string, StoredChild> } {
  const data = new Map<string, StoredChild>(); // key: `${uid}/${childId}`
  return {
    data,
    async list(uid) {
      return [...data.entries()].filter(([k]) => k.startsWith(`${uid}/`)).map(([, v]) => ownedBy(uid, v)).filter((c): c is StoredChild => c !== null).slice(0, LIST_LIMIT);
    },
    async get(uid, childId) {
      return ownedBy(uid, data.get(`${uid}/${childId}`));
    },
    async create(uid, child) {
      data.set(`${uid}/${child.id}`, { ...child });
    },
    async update(uid, childId, fn) {
      const current = ownedBy(uid, data.get(`${uid}/${childId}`));
      if (!current) return null;
      const next = fn(current);
      data.set(`${uid}/${childId}`, { ...next });
      return next;
    }
  };
}
