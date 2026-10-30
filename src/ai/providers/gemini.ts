import type { AiProvider } from "./provider.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

/** Reply shape the model must follow; the service validates it again against the candidate ids. */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    picks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: { type: "STRING" }, why: { type: "STRING" } },
        required: ["id", "why"]
      }
    }
  },
  required: ["picks"]
};

/** Messages are fixed strings: never the request, the reply or the underlying error, so the key cannot leak. */
export class GeminiError extends Error {
  override name = "GeminiError";
}

export class GeminiProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  async suggest(prompt: string, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchFn(`${BASE_URL}/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        // Key goes in a header, never the URL, so it cannot show up in logged URLs.
        headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1024,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA
          }
          // safetySettings omitted on purpose: provider defaults apply.
        }),
        signal
      });
    } catch {
      throw new GeminiError("Gemini request failed");
    }
    if (!response.ok) throw new GeminiError(`Gemini returned HTTP ${response.status}`);

    try {
      const body = (await response.json()) as { candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: unknown }> } }> };
      const candidate = body.candidates?.[0];
      // A safety block or empty reply has no candidate text; the service falls back.
      if (!candidate || (candidate.finishReason && candidate.finishReason !== "STOP")) throw new Error("no usable candidate");
      const text = (candidate.content?.parts ?? []).map((p) => (typeof p.text === "string" ? p.text : "")).join("");
      return JSON.parse(text);
    } catch {
      throw new GeminiError("Gemini reply was not usable");
    }
  }
}
