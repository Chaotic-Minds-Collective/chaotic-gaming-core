import "dotenv/config";
import { z } from "zod";
const schema = z.object({
 NODE_ENV: z.enum(["development","test","production"]).default("development"),
 HOST: z.string().default("127.0.0.1"),
 PORT: z.coerce.number().int().min(1).max(65535).default(4100),
 DATABASE_URL: z.string().url(),
 DATABASE_SSL: z.enum(["disable","require"]).default("disable"),
 LOG_LEVEL: z.string().default("info"),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) { console.error("Invalid environment configuration:",parsed.error.flatten().fieldErrors); process.exit(1); }
export const config = parsed.data;
