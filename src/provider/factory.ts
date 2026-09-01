import type { Provider } from "./types.ts";
import { OpenAIProvider } from "./openai.ts";
import { createOllamaProvider } from "./ollama.ts";
import { provider, apiKey, baseUrl, model } from "../config.ts";

export function createProvider(): Provider {
  const cfg = { apiKey, baseUrl, model };
  switch (provider) {
    case "ollama": return createOllamaProvider(cfg);
    default:       return new OpenAIProvider({ ...cfg, baseUrl: baseUrl ?? "https://api.openai.com/v1" });
  }
}