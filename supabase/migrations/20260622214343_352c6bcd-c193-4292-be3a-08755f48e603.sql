ALTER TABLE public.shopify_sync_settings
  ADD COLUMN IF NOT EXISTS token_stored boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_connection_test_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_connection_test_status text,
  ADD COLUMN IF NOT EXISTS last_connection_test_error text,
  ADD COLUMN IF NOT EXISTS oauth_state_hash text,
  ADD COLUMN IF NOT EXISTS oauth_state_expires_at timestamptz;

-- Keep granted_scopes as text[] for array storage going forward
ALTER TABLE public.shopify_sync_settings
  ALTER COLUMN granted_scopes TYPE text[] USING
    CASE
      WHEN granted_scopes IS NULL THEN NULL
      WHEN granted_scopes = '' THEN '{}'::text[]
      ELSE string_to_array(granted_scopes, ',')
    END;