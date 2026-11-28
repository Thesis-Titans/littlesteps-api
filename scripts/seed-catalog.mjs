import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { OAuth2Client } from "google-auth-library";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(__dirname, "../seed");

const SEED_TARGETS = [
  { collection: "catalog_activities", file: "catalog-activities.json" },
  { collection: "catalog_milestones", file: "catalog-milestones.json" },
  { collection: "catalog_rhymes", file: "catalog-rhymes.json" }
];

function parseArgs(argv) {
  const args = { emulator: false, projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--emulator") args.emulator = true;
    if (argv[i] === "--project" && argv[i + 1]) {
      args.projectId = argv[i + 1];
      i++;
    }
  }
  return args;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map((item) => toFirestoreValue(item)) } };
  }
  if (typeof v === "object") {
    const fields = {};
    for (const [key, val] of Object.entries(v)) {
      fields[key] = toFirestoreValue(val);
    }
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported value type: ${typeof v}`);
}

async function getFirebaseCliAccessToken() {
  const configPath = path.join(os.homedir(), ".config/configstore/firebase-tools.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!cfg.tokens) return null;
    const client = new OAuth2Client();
    client.setCredentials(cfg.tokens);
    const tokenRes = await client.getAccessToken();
    return tokenRes?.token || cfg.tokens.access_token || null;
  } catch {
    return null;
  }
}

async function seedViaRestApi(projectId, targets, accessToken) {
  const summary = [];
  const writes = [];

  for (const target of targets) {
    const filePath = path.join(seedDir, target.file);
    const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(`Seed file ${filePath} must contain a non-empty JSON array.`);
    }

    for (const item of items) {
      if (!item || typeof item.id !== "string" || item.id.trim().length === 0) {
        throw new Error(`Every document in ${target.file} must have a non-empty string id.`);
      }
      const docFields = {};
      for (const [key, val] of Object.entries(item)) {
        docFields[key] = toFirestoreValue(val);
      }
      writes.push({
        update: {
          name: `projects/${projectId}/databases/(default)/documents/${target.collection}/${item.id}`,
          fields: docFields
        }
      });
    }
    summary.push(`${items.length} ${target.collection}`);
  }

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ writes })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore REST commit failed (${res.status}): ${errText}`);
  }

  console.log(`Seeded ${summary.join(", ")} into Cloud Firestore via Firebase CLI auth (project=${projectId}).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.emulator) {
    process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
    args.projectId = args.projectId || "demo-littlesteps";
  }

  if (!args.emulator && !args.projectId) {
    console.error("Missing --project <firebase-project-id> (or set GCLOUD_PROJECT) for non-emulator seeding.");
    process.exit(1);
  }

  // If targeting cloud without GOOGLE_APPLICATION_CREDENTIALS, try Firebase CLI auth first
  if (!args.emulator && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const cliToken = await getFirebaseCliAccessToken();
    if (cliToken) {
      await seedViaRestApi(args.projectId, SEED_TARGETS, cliToken);
      return;
    }
  }

  if (getApps().length === 0) {
    initializeApp({ projectId: args.projectId });
  }

  const db = getFirestore();
  const summary = [];

  for (const target of SEED_TARGETS) {
    const filePath = path.join(seedDir, target.file);
    const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error(`Seed file ${filePath} must contain a non-empty JSON array.`);
    }

    const col = db.collection(target.collection);
    const batch = db.batch();
    for (const item of items) {
      if (!item || typeof item.id !== "string" || item.id.trim().length === 0) {
        throw new Error(`Every document in ${target.file} must have a non-empty string id.`);
      }
      batch.set(col.doc(item.id), item, { merge: false });
    }
    await batch.commit();
    summary.push(`${items.length} ${target.collection}`);
  }

  const targetLabel = args.emulator
    ? `Firestore Emulator (${process.env.FIRESTORE_EMULATOR_HOST}, project=${args.projectId})`
    : `Cloud Firestore (project=${args.projectId})`;
  console.log(`Seeded ${summary.join(", ")} into ${targetLabel}.`);
}

main().catch((err) => {
  console.error("Failed to seed catalog collections:", err);
  process.exit(1);
});
