-- Permanently disable leftover Shopify OAuth state storage.
-- The app uses SHOPIFY_ADMIN_ACCESS_TOKEN / SHOPIFY_ACCESS_TOKEN from Lovable Secrets instead.
DROP TABLE IF EXISTS public.shopify_oauth_states;

-- Raw Shopify sync settings remain service-role only. Frontend status must use /api/shopify/sync-status.
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

-- Keep order deletion admin-only at the database layer too.
DROP POLICY IF EXISTS "orders delete" ON public.orders;
CREATE POLICY "orders delete"
  ON public.orders
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
