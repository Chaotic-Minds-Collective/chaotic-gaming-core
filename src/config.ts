import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: z.string().default("false").transform((value) => value === "true"),
  STEAM_OPENID_RETURN_URL: z.string().url().optional(),
  DISCORD_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_OAUTH_REDIRECT_URL: z.string().url().optional(),
  DISCORD_LINK_COMPLETE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

const parsed = schema.parse(process.env);
const discordOAuthConfigured = Boolean(
  parsed.DISCORD_OAUTH_CLIENT_ID || parsed.DISCORD_OAUTH_CLIENT_SECRET || parsed.DISCORD_OAUTH_REDIRECT_URL
);
if (discordOAuthConfigured && !(
  parsed.DISCORD_OAUTH_CLIENT_ID &&
  parsed.DISCORD_OAUTH_CLIENT_SECRET &&
  parsed.DISCORD_OAUTH_REDIRECT_URL
)) {
  throw new Error("DISCORD_OAUTH_CLIENT_ID, DISCORD_OAUTH_CLIENT_SECRET and DISCORD_OAUTH_REDIRECT_URL must be configured together.");
}
if (parsed.NODE_ENV === "production" &&
    ((parsed.DISCORD_OAUTH_REDIRECT_URL && !parsed.DISCORD_OAUTH_REDIRECT_URL.startsWith("https://")) ||
     (parsed.DISCORD_LINK_COMPLETE_URL && !parsed.DISCORD_LINK_COMPLETE_URL.startsWith("https://"))) ) {
  throw new Error("Discord OAuth URLs must use HTTPS in production.");
}

export const config = parsed;
