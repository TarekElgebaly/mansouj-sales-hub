ALTER TABLE public.order_intake_logs
  ADD COLUMN IF NOT EXISTS shopify_order_id text,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS order_intake_logs_shopify_order_id_idx
  ON public.order_intake_logs (shopify_order_id);

CREATE INDEX IF NOT EXISTS order_intake_logs_pending_idx
  ON public.order_intake_logs (received_at)
  WHERE status = 'pending_not_found';

CREATE INDEX IF NOT EXISTS order_intake_logs_order_number_idx
  ON public.order_intake_logs (order_number);
