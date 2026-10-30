import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { StoredChild } from "./types.js";

// Every method takes the verified uid; the storage path is derived from it only.
export interface ChildrenStore {
  list(uid: string): Promise<StoredChild[]>;
  get(uid: string, childId: string): Promise<StoredChild | null>;
  create(uid: string, child: StoredChild): Promise<void>;
  replace(uid: string, child: StoredChild): Promise<void>;
}

/** Stored caregiverId must equal the path uid; a mismatch is treated as missing. */
const ownedBy = (uid: string, child: StoredChild | undefined): StoredChild | null =>
  child && child.caregiverId === uid ? child : null;

export function createFirestoreChildrenStore(): ChildrenStore {
  if (getApps().length === 0) initializeApp();
  const col = (uid: string) => getFirestore().collection("caregivers").doc(uid).collection("children");
  return {
    async list(uid) {
      const snap = await col(uid).get();
      return snap.docs.map((d) => ownedBy(uid, d.data() as StoredChild)).filter((c): c is StoredChild => c !== null);
    },
    async get(uid, childId) {
      const snap = await col(uid).doc(childId).get();
      return snap.exists ? ownedBy(uid, snap.data() as StoredChild) : null;
    },
    async create(uid, child) {
      await col(uid).doc(child.id).create(child);
    },
    async replace(uid, child) {
      await col(uid).doc(child.id).set(child);
    }
  };
}

export function createMemoryChildrenStore(): ChildrenStore & { data: Map<string, StoredChild> } {
  const data = new Map<string, StoredChild>(); // key: `${uid}/${childId}`
  return {
    data,
    async list(uid) {
      return [...data.entries()].filter(([k]) => k.startsWith(`${uid}/`)).map(([, v]) => ownedBy(uid, v)).filter((c): c is StoredChild => c !== null);
    },
    async get(uid, childId) {
      return ownedBy(uid, data.get(`${uid}/${childId}`));
    },
    async create(uid, child) {
      data.set(`${uid}/${child.id}`, { ...child });
    },
    async replace(uid, child) {
      data.set(`${uid}/${child.id}`, { ...child });
    }
  };
}
