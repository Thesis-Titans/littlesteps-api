import { Router, type Request, type Response } from "express";
import { recommend } from "./ai-service.js";
import type { AiProvider } from "./providers/provider.js";
import { RecommendationRequestSchema } from "./types.js";

let provider: AiProvider | null = null;

/** Production default is null (catalog fallback only); tests inject a fake. */
export function setAiProvider(next: AiProvider | null): void {
  provider = next;
}

const aiRouter = Router();

aiRouter.post("/recommendations", async (request: Request, response: Response) => {
  const parsed = RecommendationRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    const details = parsed.error.issues.flatMap((issue) =>
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => ({ field: key, issue: "Unknown field" }))
        : [{ field: issue.path.join("."), issue: issue.message }]
    );
    response.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid recommendation request", details } });
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  response.status(200).json(await recommend(parsed.data, provider));
});

export { aiRouter };
