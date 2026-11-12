import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.string().default("false").transform((value) => value === "true"),
});

export const config = envSchema.parse(process.env);
