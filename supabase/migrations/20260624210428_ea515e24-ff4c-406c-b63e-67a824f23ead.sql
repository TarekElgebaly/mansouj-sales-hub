-- Admin UPDATE/DELETE on migration_logs and order_activity
CREATE POLICY "migration_logs admin update" ON public.migration_logs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "migration_logs admin delete" ON public.migration_logs FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE POLICY "order_activity admin update" ON public.order_activity FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "order_activity admin delete" ON public.order_activity FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- Admin-only SELECT on shopify_oauth_states and shopify_sync_settings (currently no SELECT policy, fail-closed).
-- Re-grant SELECT to authenticated so admin reads via PostgREST work; access_token remains gated by has_role check.
GRANT SELECT ON public.shopify_oauth_states TO authenticated;
GRANT SELECT ON public.shopify_sync_settings TO authenticated;

CREATE POLICY "shopify_oauth_states admin read" ON public.shopify_oauth_states FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "shopify_sync_settings admin read" ON public.shopify_sync_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));