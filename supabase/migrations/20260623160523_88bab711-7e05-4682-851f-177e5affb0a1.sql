
-- order_notes: require write role on insert
DROP POLICY IF EXISTS "notes insert" ON public.order_notes;
CREATE POLICY "notes insert" ON public.order_notes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND public.can_write(auth.uid()));

-- order_activity: restrict to authenticated + ops/admin only
DROP POLICY IF EXISTS "activity insert" ON public.order_activity;
CREATE POLICY "activity insert" ON public.order_activity
  FOR INSERT TO authenticated
  WITH CHECK (public.can_ops(auth.uid()));

-- shopify_sync_settings: service_role only (no admin frontend reads of token)
DROP POLICY IF EXISTS "sync read admin" ON public.shopify_sync_settings;
DROP POLICY IF EXISTS "sync admin write" ON public.shopify_sync_settings;
REVOKE ALL ON public.shopify_sync_settings FROM anon, authenticated;
GRANT ALL ON public.shopify_sync_settings TO service_role;
