import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "cgk_svc_";
export function createServiceToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}
export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
export function isServiceTokenFormat(token: string): boolean {
  return token.startsWith(TOKEN_PREFIX) && token.length >= 48 && token.length <= 128;
}
