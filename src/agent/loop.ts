import type { ChatMessage } from "../config.ts";
import { chatWithTools, appendToolMessages } from "../provider/openai.ts";
import { getTool, toOpenAITools } from "../tools/registry.ts";
import type { ToolContext } from "../tools/types.ts";

const MAX_ROUNDS = 10;

export async function runAgent