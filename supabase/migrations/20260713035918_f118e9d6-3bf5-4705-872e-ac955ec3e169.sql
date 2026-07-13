
-- Try to enable pg_cron / pg_net (may no-op if not permitted)
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- inventory_refresh_queue ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_refresh_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  inventory_item_id TEXT NOT NULL,
  source_event_type TEXT NOT NULL,
  source_order_id TEXT,
  source_order_number TEXT,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  attempt_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_refresh_queue_pending_idx
  ON public.inventory_refresh_queue (status, enqueued_at)
  WHERE status IN ('pending','processing');

CREATE UNIQUE INDEX IF NOT EXISTS inventory_refresh_queue_pending_unique
  ON public.inventory_refresh_queue (inventory_item_id)
  WHERE status IN ('pending','processing');

GRANT SELECT ON public.inventory_refresh_queue TO authenticated;
GRANT ALL ON public.inventory_refresh_queue TO service_role;
ALTER TABLE public.inventory_refresh_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops can read inventory_refresh_queue"
  ON public.inventory_refresh_queue FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operations'));

-- inventory_event_log ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_event_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  order_number TEXT,
  shopify_order_id TEXT,
  inventory_item_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  success BOOLEAN NOT NULL DEFAULT true,
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT,
  processing_duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_event_log_time_idx
  ON public.inventory_event_log (event_time DESC);

GRANT SELECT ON public.inventory_event_log TO authenticated;
GRANT ALL ON public.inventory_event_log TO service_role;
ALTER TABLE public.inventory_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops can read inventory_event_log"
  ON public.inventory_event_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operations'));

-- shopify_webhook_deliveries (dedup) -------------------------------------
CREATE TABLE IF NOT EXISTS public.shopify_webhook_deliveries (
  webhook_id TEXT NOT NULL PRIMARY KEY,
  topic TEXT,
  shopify_order_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS shopify_webhook_deliveries_received_idx
  ON public.shopify_webhook_deliveries (received_at DESC);

GRANT SELECT ON public.shopify_webhook_deliveries TO authenticated;
GRANT ALL ON public.shopify_webhook_deliveries TO service_role;
ALTER TABLE public.shopify_webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ops can read shopify_webhook_deliveries"
  ON public.shopify_webhook_deliveries FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'operations'));

-- updated_at triggers ----------------------------------------------------
DROP TRIGGER IF EXISTS trg_inventory_refresh_queue_updated_at ON public.inventory_refresh_queue;
CREATE TRIGGER trg_inventory_refresh_queue_updated_at
  BEFORE UPDATE ON public.inventory_refresh_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Schedule pg_cron safety-net flush (once per minute), if pg_cron is available.
DO $$
DECLARE
  has_cron BOOLEAN;
  has_net BOOLEAN;
  base_url TEXT := 'https://mansouj-sales-hub.lovable.app';
  anon_key TEXT := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91YmJxZmlzanRvZnptY2Nkb2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwMjYyMjQsImV4cCI6MjA5NzYwMjIyNH0.cukKciPHsgbbFlnhDqvh5QlSACa1AFZj7HuYg1QZbtM';
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') INTO has_cron;
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net') INTO has_net;
  IF has_cron AND has_net THEN
    BEGIN
      PERFORM cron.unschedule('inventory-refresh-queue-flush');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'inventory-refresh-queue-flush',
      '* * * * *',
      format($cron$
        SELECT net.http_post(
          url := %L,
          headers := %L::jsonb,
          body := %L::jsonb
        );
      $cron$,
        base_url || '/api/public/inventory/flush-refresh-queue',
        json_build_object('Content-Type','application/json','apikey',anon_key)::text,
        '{"source":"pg_cron"}'
      )
    );
  END IF;
END $$;
