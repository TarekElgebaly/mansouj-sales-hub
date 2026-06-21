ALTER TABLE public.shopify_sync_settings
  ADD COLUMN IF NOT EXISTS last_orders_imported integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_orders_updated integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text;
INSERT INTO public.shopify_sync_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;