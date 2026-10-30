import { onRequest } from "firebase-functions/v2/https";
import { app } from "./app.js";
import { setAiProvider } from "./ai/ai-router.js";
import { createConfiguredProvider } from "./ai/providers/configure.js";
import { createFirestoreRateLimiter, setRateLimiter, USER_LIMIT } from "./ai/rate-limit.js";

setRateLimiter(createFirestoreRateLimiter(USER_LIMIT));
// Null unless GEMINI_API_KEY and GEMINI_MODEL are both set; the endpoint then serves the catalog fallback.
setAiProvider(createConfiguredProvider(process.env));

export const api = onRequest(
  { region: "asia-southeast1", timeoutSeconds: 30, memory: "256MiB" },
  app
);
