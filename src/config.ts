process.loadEnvFile();

import { z } from "zod";

const env = z.object({
  MINIHARNESS_API_KEY: z.string().min(1),
  MINIHARNESS_BASE_URL: z.string().url(),
  MINIHARNESS_MODEL: z.string().min(1),
}).parse(process.env);

export const apiKey = env.MINIHARNESS_API_KEY;
export const baseUrl = env.MINIHARNESS_BASE_URL;
export const model = env.MINIHARNESS_MODEL;