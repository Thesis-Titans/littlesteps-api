import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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
