-- Keep user and service records aligned with the principal discriminator.
CREATE OR REPLACE FUNCTION core.enforce_principal_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actual_type TEXT;
BEGIN
  SELECT principal_type INTO actual_type
    FROM core.principals
   WHERE id = NEW.principal_id
   FOR KEY SHARE;

  IF actual_type IS DISTINCT FROM TG_ARGV[0] THEN
    RAISE EXCEPTION 'Principal % must have type %', NEW.principal_id, TG_ARGV[0]
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_principal_type_guard ON core.users;
CREATE TRIGGER users_principal_type_guard
BEFORE INSERT OR UPDATE OF principal_id ON core.users
FOR EACH ROW EXECUTE FUNCTION core.enforce_principal_type('user');

DROP TRIGGER IF EXISTS service_accounts_principal_type_guard ON core.service_accounts;
CREATE TRIGGER service_accounts_principal_type_guard
BEFORE INSERT OR UPDATE OF principal_id ON core.service_accounts
FOR EACH ROW EXECUTE FUNCTION core.enforce_principal_type('service');

-- A server must belong to a cluster for the same game.
ALTER TABLE core.clusters
  ADD CONSTRAINT clusters_id_game_key_uq UNIQUE (id, game_key);
ALTER TABLE core.servers
  ADD CONSTRAINT servers_cluster_game_fk
  FOREIGN KEY (cluster_id, game_key)
  REFERENCES core.clusters (id, game_key)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS principal_role_scope_uq
  ON core.principal_role_assignments
  (principal_id, role_id, scope_type, COALESCE(scope_id, ''));

ALTER TABLE commerce.orders
  ADD COLUMN IF NOT EXISTS request_hash TEXT;
