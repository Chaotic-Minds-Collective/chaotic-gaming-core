import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: z.string().default("false").transform((value) => value === "true"),
  STEAM_OPENID_RETURN_URL: z.string().url().optional(),
  PAYMENTS_ENABLED: z.string().default("false").transform((value) => value.toLowerCase() === "true"),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_SUCCESS_URL: z.string().url().optional(),
  STRIPE_CANCEL_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export const config = schema.parse(process.env);
