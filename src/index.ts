import { onRequest } from "firebase-functions/v2/https";
import { app } from "./app.js";

export const api = onRequest(
  { region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB" },
  app
);
