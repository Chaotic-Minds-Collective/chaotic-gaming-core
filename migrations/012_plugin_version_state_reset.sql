CREATE OR REPLACE FUNCTION operations.reset_plugin_installation_on_version_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.plugin_version_id IS DISTINCT FROM OLD.plugin_version_id THEN
    NEW.lifecycle_status := 'DISCOVERED';
    NEW.health_message := NULL;
    NEW.last_health_at := NULL;
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER plugin_installation_version_reset
BEFORE UPDATE OF plugin_version_id ON core.plugin_installations
FOR EACH ROW
EXECUTE FUNCTION operations.reset_plugin_installation_on_version_change();
