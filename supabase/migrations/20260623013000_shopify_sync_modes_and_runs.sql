ALTER TABLE public.shopify_sync_settings
  ADD COLUMN IF NOT EXISTS last_sync_mode text,
  ADD COLUMN IF NOT EXISTS last_successful_orders_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_orders_sync_cursor timestamptz;

CREATE TABLE IF NOT EXISTS public.shopify_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  records_processed integer NOT NULL DEFAULT 0,
  created_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  pages_fetched integer NOT NULL DEFAULT 0,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

GRANT SELECT ON public.shopify_sync_runs TO authenticated;
GRANT ALL ON public.shopify_sync_runs TO service_role;
ALTER TABLE public.shopify_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shopify sync runs read admin" ON public.shopify_sync_runs;
CREATE POLICY "shopify sync runs read admin" ON public.shopify_sync_runs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operations'));
