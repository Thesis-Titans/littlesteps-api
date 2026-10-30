import { CircuitBreakerProvider } from "./circuit-breaker.js";
import { GeminiProvider } from "./gemini.js";
import type { AiProvider } from "./provider.js";

/** Both variables are required and there is no default model; otherwise null keeps the catalog fallback. */
export function createConfiguredProvider(env: NodeJS.ProcessEnv): AiProvider | null {
  const apiKey = env.GEMINI_API_KEY?.trim();
  const model = env.GEMINI_MODEL?.trim();
  if (!apiKey || !model || !/^[A-Za-z0-9._-]+$/.test(model)) return null;
  return new CircuitBreakerProvider(new GeminiProvider(apiKey, model));
}
