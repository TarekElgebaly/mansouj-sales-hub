
ALTER TABLE public.shopify_variants
  ADD COLUMN IF NOT EXISTS is_shopify_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE public.shopify_products
  ADD COLUMN IF NOT EXISTS is_shopify_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS shopify_variants_stale_idx
  ON public.shopify_variants (is_shopify_stale);
CREATE INDEX IF NOT EXISTS shopify_products_stale_idx
  ON public.shopify_products (is_shopify_stale);

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS is_shopify_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shopify_product_id text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id text,
  ADD COLUMN IF NOT EXISTS inventory_item_id text,
  ADD COLUMN IF NOT EXISTS on_hand_quantity numeric,
  ADD COLUMN IF NOT EXISTS available_quantity numeric,
  ADD COLUMN IF NOT EXISTS committed_quantity numeric,
  ADD COLUMN IF NOT EXISTS unavailable_quantity numeric,
  ADD COLUMN IF NOT EXISTS incoming_quantity numeric,
  ADD COLUMN IF NOT EXISTS shopify_product_status text,
  ADD COLUMN IF NOT EXISTS shopify_product_type text,
  ADD COLUMN IF NOT EXISTS shopify_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS shopify_raw jsonb;

CREATE INDEX IF NOT EXISTS inventory_shopify_variant_idx
  ON public.inventory (shopify_variant_id);
CREATE INDEX IF NOT EXISTS inventory_inventory_item_idx
  ON public.inventory (inventory_item_id);
CREATE INDEX IF NOT EXISTS inventory_stale_idx
  ON public.inventory (is_shopify_stale);
