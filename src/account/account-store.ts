import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import type { StoredCaregiverProfile } from "./types.js";

export interface CaregiversStore {
  getProfile(uid: string): Promise<StoredCaregiverProfile | null>;
  deleteCaregiver(uid: string): Promise<void>;
}

export {
  createFirestoreJournalStore,
  createMemoryJournalStore,
  JOURNAL_LIST_LIMIT,
  type JournalStore
} from "../journal/journal-store.js";

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

