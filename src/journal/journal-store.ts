import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { stripUndefined } from "../strip-undefined.js";
import type { JournalListFilter, StoredJournalEntry } from "./types.js";

export interface JournalStore {
  list(uid: string, childId: string, filter?: JournalListFilter): Promise<StoredJournalEntry[]>;
  get(uid: string, childId: string, entryId: string): Promise<StoredJournalEntry | null>;
  create(uid: string, childId: string, entry: StoredJournalEntry): Promise<boolean>;
  update(
    uid: string,
    childId: string,
    entryId: string,
    fn: (current: StoredJournalEntry) => StoredJournalEntry
  ): Promise<StoredJournalEntry | null>;
  delete(uid: string, childId: string, entryId: string): Promise<boolean>;
  deleteAllForChild?(uid: string, childId: string): Promise<void>;
}

export const JOURNAL_LIST_LIMIT = 100;

export const ownedJournalEntry = (
  uid: string,
  childId: string,
  entry: StoredJournalEntry | undefined
): StoredJournalEntry | null =>
  entry && entry.caregiverId === uid && entry.childId === childId ? entry : null;

export function createFirestoreJournalStore(): JournalStore {
  if (getApps().length === 0) initializeApp();
  const col = (uid: string, childId: string) =>
    getFirestore()
      .collection("caregivers")
      .doc(uid)
      .collection("children")
      .doc(childId)
      .collection("journal_entries");

  return {
    async list(uid, childId, filter) {
      let query: FirebaseFirestore.Query = col(uid, childId);
      if (filter?.date) {
        query = query.where("entryDate", "==", filter.date);
      }
      const snap = await query
        .orderBy("entryDate", "desc")
        .orderBy(FieldPath.documentId(), "desc")
        .limit(JOURNAL_LIST_LIMIT)
        .get();
      return snap.docs
        .map((d) => ownedJournalEntry(uid, childId, d.data() as StoredJournalEntry))
        .filter((e): e is StoredJournalEntry => e !== null);
    },
    async get(uid, childId, entryId) {
      const snap = await col(uid, childId).doc(entryId).get();
      return snap.exists ? ownedJournalEntry(uid, childId, snap.data() as StoredJournalEntry) : null;
    },
    async create(uid, childId, entry) {
      await col(uid, childId).doc(entry.id).set(stripUndefined(entry));
      return true;
    },
    async update(uid, childId, entryId, fn) {
      const ref = col(uid, childId).doc(entryId);
      return getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? ownedJournalEntry(uid, childId, snap.data() as StoredJournalEntry) : null;
        if (!current) return null;
        const next = fn(current);
        tx.set(ref, stripUndefined(next));
        return next;
      });
    },
    async delete(uid, childId, entryId) {
      const ref = col(uid, childId).doc(entryId);
      return getFirestore().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const current = snap.exists ? ownedJournalEntry(uid, childId, snap.data() as StoredJournalEntry) : null;
        if (!current) return false;
        tx.delete(ref);
        return true;
      });
    },
    async deleteAllForChild(uid, childId) {
      const db = getFirestore();
      await db.recursiveDelete(col(uid, childId));
    }
  };
}

export function createMemoryJournalStore(): JournalStore & { data: Map<string, StoredJournalEntry> } {
  const data = new Map<string, StoredJournalEntry>(); // key: `${uid}/${childId}/${entryId}`

  return {
    data,
    async list(uid, childId, filter) {
      return [...data.entries()]
        .filter(([k]) => k.startsWith(`${uid}/${childId}/`))
        .map(([, v]) => ownedJournalEntry(uid, childId, v))
        .filter((e): e is StoredJournalEntry => e !== null)
        .filter((e) => (filter?.date ? e.entryDate === filter.date : true))
        .sort(
          (a, b) =>
            b.entryDate.localeCompare(a.entryDate) ||
            b.id.localeCompare(a.id)
        )
        .slice(0, JOURNAL_LIST_LIMIT);
    },
    async get(uid, childId, entryId) {
      return ownedJournalEntry(uid, childId, data.get(`${uid}/${childId}/${entryId}`));
    },
    async create(uid, childId, entry) {
      data.set(`${uid}/${childId}/${entry.id}`, { ...entry });
      return true;
    },
    async update(uid, childId, entryId, fn) {
      const current = ownedJournalEntry(uid, childId, data.get(`${uid}/${childId}/${entryId}`));
      if (!current) return null;
      const next = fn(current);
      data.set(`${uid}/${childId}/${entryId}`, { ...next });
      return next;
    },
    async delete(uid, childId, entryId) {
      const current = ownedJournalEntry(uid, childId, data.get(`${uid}/${childId}/${entryId}`));
      if (!current) return false;
      data.delete(`${uid}/${childId}/${entryId}`);
      return true;
    },
    async deleteAllForChild(uid, childId) {
      for (const k of data.keys()) {
        if (k.startsWith(`${uid}/${childId}/`)) data.delete(k);
      }
    }
  };
}
