-- Final security hardening after removing Shopify install routes from the app.
-- There must be no OAuth state storage path left for frontend or server routes.
DROP TABLE IF EXISTS public.shopify_oauth_states;

ALTER TABLE public.shopify_installations
  DROP COLUMN IF EXISTS oauth_state_hash,
  DROP COLUMN IF EXISTS oauth_state_expires_at;

REVOKE ALL ON TABLE public.shopify_sync_settings FROM anon;
REVOKE ALL ON TABLE public.shopify_sync_settings FROM authenticated;
GRANT ALL ON TABLE public.shopify_sync_settings TO service_role;

ALTER TABLE public.shopify_sync_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sync settings deny direct select" ON public.shopify_sync_settings;
CREATE POLICY "sync settings deny direct select"
  ON public.shopify_sync_settings
  FOR SELECT
  TO anon, authenticated
  USING (false);

-- Audit/log correction remains possible only for admins, never operations/viewers.
GRANT UPDATE, DELETE ON TABLE public.migration_logs TO authenticated;

DROP POLICY IF EXISTS "logs update ops" ON public.migration_logs;
DROP POLICY IF EXISTS "logs delete ops" ON public.migration_logs;
DROP POLICY IF EXISTS "logs update admin" ON public.migration_logs;
CREATE POLICY "logs update admin"
  ON public.migration_logs
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "logs delete admin" ON public.migration_logs;
CREATE POLICY "logs delete admin"
  ON public.migration_logs
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

GRANT UPDATE, DELETE ON TABLE public.order_activity TO authenticated;

DROP POLICY IF EXISTS "activity update ops" ON public.order_activity;
DROP POLICY IF EXISTS "activity delete ops" ON public.order_activity;
DROP POLICY IF EXISTS "activity update admin" ON public.order_activity;
CREATE POLICY "activity update admin"
  ON public.order_activity
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "activity delete admin" ON public.order_activity;
CREATE POLICY "activity delete admin"
  ON public.order_activity
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Keep order deletion admin-only at the database layer.
DROP POLICY IF EXISTS "orders delete" ON public.orders;
CREATE POLICY "orders delete"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
