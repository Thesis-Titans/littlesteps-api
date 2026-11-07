import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import { stripUndefined } from "../strip-undefined.js";
import type { StoredCaregiverProfile, StoredJournalEntry } from "./types.js";

export interface CaregiversStore {
  getProfile(uid: string): Promise<StoredCaregiverProfile | null>;
  deleteCaregiver(uid: string): Promise<void>;
}

export interface JournalStore {
  list(uid: string, childId: string): Promise<StoredJournalEntry[]>;
  create(uid: string, childId: string, entry: StoredJournalEntry): Promise<boolean>;
  deleteAllForChild?(uid: string, childId: string): Promise<void>;
}

export const JOURNAL_LIST_LIMIT = 100;

const ownedProfile = (uid: string, profile: Partial<StoredCaregiverProfile> | undefined): StoredCaregiverProfile | null => {
  if (!profile) return null;
  if (profile.uid !== undefined && profile.uid !== uid) return null;
  return {
    uid,
    ...(typeof profile.email === "string" ? { email: profile.email } : {}),
    ...(typeof profile.displayName === "string" ? { displayName: profile.displayName } : {}),
    ...(profile.weatherLocation &&
    typeof profile.weatherLocation.name === "string" &&
    typeof profile.weatherLocation.latitude === "number" &&
    typeof profile.weatherLocation.longitude === "number"
      ? {
          weatherLocation: {
            name: profile.weatherLocation.name,
            latitude: profile.weatherLocation.latitude,
            longitude: profile.weatherLocation.longitude
          }
        }
      : {}),
    ...(typeof profile.createdAt === "string" ? { createdAt: profile.createdAt } : {}),
    ...(typeof profile.updatedAt === "string" ? { updatedAt: profile.updatedAt } : {})
  };
};

const ownedJournalEntry = (
  uid: string,
  childId: string,
  entry: StoredJournalEntry | undefined
): StoredJournalEntry | null =>
  entry && entry.caregiverId === uid && entry.childId === childId ? entry : null;

export function createFirestoreCaregiversStore(): CaregiversStore {
  if (getApps().length === 0) initializeApp();
  const docRef = (uid: string) => getFirestore().collection("caregivers").doc(uid);

  return {
    async getProfile(uid) {
      const snap = await docRef(uid).get();
      if (!snap.exists) return null;
      return ownedProfile(uid, snap.data() as Partial<StoredCaregiverProfile>);
    },
    async deleteCaregiver(uid) {
      const db = getFirestore();
      const caregiverRef = docRef(uid);
      // Clean up any remaining or phantom child documents with subcollections before removing the caregiver doc.
      const childRefs = await caregiverRef.collection("children").listDocuments();
      for (const childRef of childRefs) {
        const snap = await childRef.get();
        if (snap.exists && (snap.data() as { caregiverId?: unknown } | undefined)?.caregiverId !== uid) {
          continue;
        }
        await db.recursiveDelete(childRef);
      }
      await caregiverRef.delete();
    }
  };
}

export function createMemoryCaregiversStore(): CaregiversStore & { data: Map<string, StoredCaregiverProfile> } {
  const data = new Map<string, StoredCaregiverProfile>();

  return {
    data,
    async getProfile(uid) {
      return ownedProfile(uid, data.get(uid));
    },
    async deleteCaregiver(uid) {
      data.delete(uid);
    }
  };
}

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
    async list(uid, childId) {
      const snap = await col(uid, childId)
        .orderBy("entryDate")
        .orderBy(FieldPath.documentId())
        .limit(JOURNAL_LIST_LIMIT)
        .get();
      return snap.docs
        .map((d) => ownedJournalEntry(uid, childId, d.data() as StoredJournalEntry))
        .filter((e): e is StoredJournalEntry => e !== null);
    },
    async create(uid, childId, entry) {
      await col(uid, childId).doc(entry.id).set(stripUndefined(entry));
      return true;
    }
  };
}

export function createMemoryJournalStore(): JournalStore & { data: Map<string, StoredJournalEntry> } {
  const data = new Map<string, StoredJournalEntry>(); // key: `${uid}/${childId}/${entryId}`

  return {
    data,
    async list(uid, childId) {
      return [...data.entries()]
        .filter(([k]) => k.startsWith(`${uid}/${childId}/`))
        .map(([, v]) => ownedJournalEntry(uid, childId, v))
        .filter((e): e is StoredJournalEntry => e !== null)
        .sort(
          (a, b) =>
            a.entryDate.localeCompare(b.entryDate) ||
            a.createdAt.localeCompare(b.createdAt) ||
            a.id.localeCompare(b.id)
        )
        .slice(0, JOURNAL_LIST_LIMIT);
    },
    async create(uid, childId, entry) {
      data.set(`${uid}/${childId}/${entry.id}`, { ...entry });
      return true;
    },
    async deleteAllForChild(uid, childId) {
      for (const k of data.keys()) {
        if (k.startsWith(`${uid}/${childId}/`)) data.delete(k);
      }
    }
  };
}

