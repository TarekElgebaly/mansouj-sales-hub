ALTER TABLE public.shopify_sync_settings
  ADD COLUMN IF NOT EXISTS shop_domain text,
  ADD COLUMN IF NOT EXISTS granted_scopes text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS install_status text DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS installed_at timestamptz,
  ADD COLUMN IF NOT EXISTS token_stored boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_connection_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_connection_test_status text,
  ADD COLUMN IF NOT EXISTS last_connection_test_error text;

CREATE TABLE IF NOT EXISTS public.shopify_installations (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  shop_domain text NOT NULL,
  access_token text NOT NULL,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  install_status text NOT NULL DEFAULT 'connected',
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.shopify_installations TO service_role;
REVOKE ALL ON public.shopify_installations FROM anon;
REVOKE ALL ON public.shopify_installations FROM authenticated;
ALTER TABLE public.shopify_installations ENABLE ROW LEVEL SECURITY;

INSERT INTO public.shopify_sync_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
