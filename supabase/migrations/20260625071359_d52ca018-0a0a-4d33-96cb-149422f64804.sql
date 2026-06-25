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
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.shopify_sync_runs TO authenticated;
GRANT ALL ON public.shopify_sync_runs TO service_role;

ALTER TABLE public.shopify_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync runs visible to ops/finance"
ON public.shopify_sync_runs FOR SELECT TO authenticated
USING (public.can_ops(auth.uid()) OR public.has_role(auth.uid(),'finance'));

CREATE INDEX IF NOT EXISTS shopify_sync_runs_started_at_idx ON public.shopify_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS shopify_sync_runs_sync_type_idx ON public.shopify_sync_runs (sync_type, started_at DESC);