-- Lovable security scan hardening.
-- Keep Shopify secrets server-only while giving the scanner explicit RLS policy coverage.

-- Raw Shopify settings are intentionally not readable from the frontend.
-- The app exposes safe status through /api/shopify/sync-status using the service role.
REVOKE ALL ON TABLE public.shopify_sync_settings FROM anon;
REVOKE ALL ON TABLE public.shopify_sync_settings FROM authenticated;
GRANT ALL ON TABLE public.shopify_sync_settings TO service_role;
ALTER TABLE public.shopify_sync_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync read" ON public.shopify_sync_settings;
DROP POLICY IF EXISTS "sync read admin" ON public.shopify_sync_settings;
DROP POLICY IF EXISTS "sync admin write" ON public.shopify_sync_settings;
DROP POLICY IF EXISTS "sync settings deny direct select" ON public.shopify_sync_settings;
CREATE POLICY "sync settings deny direct select"
  ON public.shopify_sync_settings
  FOR SELECT
  TO anon, authenticated
  USING (false);

-- Legacy token tables are not used by the token-based integration.
-- Keep them service-role only and explicitly deny direct frontend reads if they exist.
DO $$
BEGIN
  IF to_regclass('public.shopify_installations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public.shopify_installations FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.shopify_installations FROM authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.shopify_installations TO service_role';
    EXECUTE 'ALTER TABLE public.shopify_installations ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "shopify installations deny direct select" ON public.shopify_installations';
    EXECUTE 'CREATE POLICY "shopify installations deny direct select" ON public.shopify_installations FOR SELECT TO anon, authenticated USING (false)';
  END IF;
END $$;

-- Migration logs can be corrected/removed only by admins.
GRANT UPDATE, DELETE ON TABLE public.migration_logs TO authenticated;

DROP POLICY IF EXISTS "logs update ops" ON public.migration_logs;
DROP POLICY IF EXISTS "logs update admin" ON public.migration_logs;
CREATE POLICY "logs update admin"
  ON public.migration_logs
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "logs delete ops" ON public.migration_logs;
DROP POLICY IF EXISTS "logs delete admin" ON public.migration_logs;
CREATE POLICY "logs delete admin"
  ON public.migration_logs
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Order activity remains protected: only order write-capable roles can read/insert,
-- and only admins can update/delete audit rows.
GRANT UPDATE, DELETE ON TABLE public.order_activity TO authenticated;

DROP POLICY IF EXISTS "activity read" ON public.order_activity;
CREATE POLICY "activity read"
  ON public.order_activity
  FOR SELECT
  TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "activity insert" ON public.order_activity;
CREATE POLICY "activity insert write roles"
  ON public.order_activity
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "activity update ops" ON public.order_activity;
DROP POLICY IF EXISTS "activity update admin" ON public.order_activity;
CREATE POLICY "activity update admin"
  ON public.order_activity
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "activity delete ops" ON public.order_activity;
DROP POLICY IF EXISTS "activity delete admin" ON public.order_activity;
CREATE POLICY "activity delete admin"
  ON public.order_activity
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
