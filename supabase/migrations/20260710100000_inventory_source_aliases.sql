-- Add stable Shopify source-of-truth aliases for Inventory.
-- Existing legacy columns remain in place for compatibility.

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS shopify_inventory_item_id text,
  ADD COLUMN IF NOT EXISTS product_title text,
  ADD COLUMN IF NOT EXISTS variant_title text,
  ADD COLUMN IF NOT EXISTS product_status text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS cost numeric(12, 2),
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

UPDATE public.inventory
SET
  shopify_inventory_item_id = COALESCE(shopify_inventory_item_id, inventory_item_id),
  product_title = COALESCE(product_title, product_name),
  variant_title = COALESCE(variant_title, variant_name),
  product_status = COALESCE(product_status, shopify_product_status),
  product_type = COALESCE(product_type, shopify_product_type),
  image_url = COALESCE(image_url, product_images->>0),
  cost = COALESCE(cost, cost_price),
  is_stale = COALESCE(is_stale, is_shopify_stale, false),
  last_synced_at = COALESCE(last_synced_at, shopify_synced_at, updated_at)
WHERE shopify_inventory_item_id IS NULL
   OR product_title IS NULL
   OR variant_title IS NULL
   OR product_status IS NULL
   OR product_type IS NULL
   OR image_url IS NULL
   OR cost IS NULL
   OR last_synced_at IS NULL;

CREATE INDEX IF NOT EXISTS inventory_shopify_inventory_item_id_idx
  ON public.inventory(shopify_inventory_item_id)
  WHERE shopify_inventory_item_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'inventory'
      AND indexname = 'inventory_shopify_inventory_item_id_active_unique'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory
    WHERE shopify_inventory_item_id IS NOT NULL
      AND COALESCE(is_stale, is_shopify_stale, false) = false
    GROUP BY shopify_inventory_item_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX inventory_shopify_inventory_item_id_active_unique
      ON public.inventory(shopify_inventory_item_id)
      WHERE shopify_inventory_item_id IS NOT NULL
        AND COALESCE(is_stale, is_shopify_stale, false) = false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'inventory'
      AND indexname = 'inventory_shopify_variant_id_active_unique'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory
    WHERE shopify_variant_id IS NOT NULL
      AND COALESCE(is_stale, is_shopify_stale, false) = false
    GROUP BY shopify_variant_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX inventory_shopify_variant_id_active_unique
      ON public.inventory(shopify_variant_id)
      WHERE shopify_variant_id IS NOT NULL
        AND COALESCE(is_stale, is_shopify_stale, false) = false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS inventory_product_status_idx
  ON public.inventory(product_status);

CREATE INDEX IF NOT EXISTS inventory_is_stale_idx
  ON public.inventory(is_stale);

NOTIFY pgrst, 'reload schema';
