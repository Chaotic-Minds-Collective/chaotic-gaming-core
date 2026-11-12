import { hashServiceToken, isServiceTokenFormat } from "./tokens.js";
import { pool } from "../db.js";

export interface AuthenticatedService { principalId: string; applicationName: string; }

export async function authenticateServiceToken(token: string): Promise<AuthenticatedService | null> {
  if (!isServiceTokenFormat(token)) return null;
  const result = await pool.query(
    `SELECT p.id, sa.application_name
     FROM core.service_accounts sa
     JOIN core.principals p ON p.id = sa.principal_id
     WHERE sa.credential_hash = $1
       AND p.principal_type = 'service'
       AND p.status = 'active'`,
    [hashServiceToken(token)],
  );
  const row = result.rows[0] as { id: string; application_name: string } | undefined;
  return row ? { principalId: row.id, applicationName: row.application_name } : null;
}

export async function serviceHasPermission(principalId: string, permissionKey: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM core.principal_role_assignments pra
       JOIN core.role_permissions rp ON rp.role_id = pra.role_id
       JOIN core.permissions p ON p.id = rp.permission_id
       WHERE pra.principal_id = $1
         AND pra.scope_type = 'platform'
         AND pra.scope_id IS NULL
         AND (pra.expires_at IS NULL OR pra.expires_at > NOW())
         AND p.permission_key = $2
     ) AS allowed`,
    [principalId, permissionKey],
  );
  return result.rows[0]?.allowed === true;
}

export function bearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}
