CREATE TABLE IF NOT EXISTS public.order_intake_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz NOT NULL DEFAULT now(),
  source text,
  order_number text,
  matched_order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  status text NOT NULL,
  repaired_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  message_id text,
  payload_hash text,
  raw_payload jsonb
);

GRANT SELECT ON public.order_intake_logs TO authenticated;
GRANT ALL ON public.order_intake_logs TO service_role;

ALTER TABLE public.order_intake_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intake logs visible to ops"
ON public.order_intake_logs FOR SELECT TO authenticated
USING (public.can_ops(auth.uid()));

CREATE INDEX IF NOT EXISTS order_intake_logs_received_at_idx ON public.order_intake_logs (received_at DESC);
CREATE INDEX IF NOT EXISTS order_intake_logs_status_idx ON public.order_intake_logs (status, received_at DESC);
CREATE INDEX IF NOT EXISTS order_intake_logs_message_id_idx ON public.order_intake_logs (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_intake_logs_payload_hash_idx ON public.order_intake_logs (order_number, payload_hash);