import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().url().optional(),
  DATABASE_SSL: z.string().default("false").transform((value) => value === "true"),
  STEAM_OPENID_RETURN_URL: z.string().url().optional(),
  DISCORD_OAUTH_CLIENT_ID: z.string().regex(/^\d{17,20}$/).optional(),
  DISCORD_OAUTH_CLIENT_SECRET: z.string().min(1).max(256).optional(),
  DISCORD_OAUTH_REDIRECT_URI: z.string().url().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info")
});

export const config = schema.parse(process.env);

const discordOAuthValues = [
  config.DISCORD_OAUTH_CLIENT_ID,
  config.DISCORD_OAUTH_CLIENT_SECRET,
  config.DISCORD_OAUTH_REDIRECT_URI,
];
const discordOAuthConfigured = discordOAuthValues.every(Boolean);
if (discordOAuthValues.some(Boolean) && !discordOAuthConfigured) {
  throw new Error("DISCORD_OAUTH_CLIENT_ID, DISCORD_OAUTH_CLIENT_SECRET and DISCORD_OAUTH_REDIRECT_URI must be configured together.");
}
if (discordOAuthConfigured && config.DISCORD_OAUTH_REDIRECT_URI) {
  const redirect = new URL(config.DISCORD_OAUTH_REDIRECT_URI);
  const localHosts = ["localhost", "127.0.0.1", "::1"];
  if (redirect.protocol !== "https:" && !(redirect.protocol === "http:" && localHosts.includes(redirect.hostname))) {
    throw new Error("DISCORD_OAUTH_REDIRECT_URI must use HTTPS except for loopback development URLs.");
  }
  if (redirect.username || redirect.password || redirect.hash) {
    throw new Error("DISCORD_OAUTH_REDIRECT_URI must not contain credentials or a fragment.");
  }
}
