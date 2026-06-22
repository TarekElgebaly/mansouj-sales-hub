
ALTER TABLE public.shopify_sync_settings
  ADD COLUMN IF NOT EXISTS shop_domain text,
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS granted_scopes text,
  ADD COLUMN IF NOT EXISTS install_status text DEFAULT 'not_installed',
  ADD COLUMN IF NOT EXISTS installed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_test_ok boolean,
  ADD COLUMN IF NOT EXISTS last_test_message text;

REVOKE SELECT (access_token), UPDATE (access_token), INSERT (access_token)
  ON public.shopify_sync_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.shopify_oauth_states (
  state text PRIMARY KEY,
  shop_domain text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

GRANT ALL ON public.shopify_oauth_states TO service_role;
ALTER TABLE public.shopify_oauth_states ENABLE ROW LEVEL SECURITY;
