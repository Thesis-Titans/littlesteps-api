import { onRequest } from "firebase-functions/v2/https";
import { app } from "./app.js";
import { createFirestoreRateLimiter, setRateLimiter, USER_LIMIT } from "./ai/rate-limit.js";

setRateLimiter(createFirestoreRateLimiter(USER_LIMIT));

export const api = onRequest(
  { region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB" },
  app
);
