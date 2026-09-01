import { OpenAIProvider, type ProviderConfig } from "./openai.ts";
import type { Provider } from "./types.ts";

export function createOllamaProvider(cfg: ProviderConfig): Provider {
  return new OpenAIProvider({
    ...cfg,
    baseUrl: cfg.baseUrl || "http://localhost:11434/v1",
    apiKey: cfg.apiKey || "ollama", // Ollama 不校验 key
  });
}