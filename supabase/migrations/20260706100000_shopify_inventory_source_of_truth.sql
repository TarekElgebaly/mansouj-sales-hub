-- Store Shopify location-level on-hand quantity and key the local inventory table
-- to Shopify source-of-truth IDs. SKU remains display/search data only.

ALTER TABLE public.shopify_inventory_levels
  ADD COLUMN IF NOT EXISTS on_hand integer;

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS shopify_product_id text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id text,
  ADD COLUMN IF NOT EXISTS inventory_item_id text,
  ADD COLUMN IF NOT EXISTS shopify_product_status text,
  ADD COLUMN IF NOT EXISTS shopify_product_type text,
  ADD COLUMN IF NOT EXISTS available_quantity integer,
  ADD COLUMN IF NOT EXISTS on_hand_quantity integer,
  ADD COLUMN IF NOT EXISTS shopify_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_shopify_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shopify_raw jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_shopify_variant_id_unique
  ON public.inventory(shopify_variant_id)
  WHERE shopify_variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_inventory_item_id_idx
  ON public.inventory(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_shopify_status_idx
  ON public.inventory(shopify_product_status);

CREATE INDEX IF NOT EXISTS inventory_shopify_stale_idx
  ON public.inventory(is_shopify_stale);

NOTIFY pgrst, 'reload schema';
