ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS shopify_order_id text,
  ADD COLUMN IF NOT EXISTS shopify_line_item_id text,
  ADD COLUMN IF NOT EXISTS shopify_admin_graphql_api_id text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id text,
  ADD COLUMN IF NOT EXISTS shopify_product_id text,
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS image_url text;

CREATE INDEX IF NOT EXISTS order_items_shopify_order_idx
  ON public.order_items(shopify_order_id);

CREATE INDEX IF NOT EXISTS order_items_shopify_line_item_idx
  ON public.order_items(shopify_line_item_id);

CREATE INDEX IF NOT EXISTS order_items_shopify_variant_idx
  ON public.order_items(shopify_variant_id);

CREATE INDEX IF NOT EXISTS order_items_shopify_product_idx
  ON public.order_items(shopify_product_id);

CREATE INDEX IF NOT EXISTS order_items_barcode_idx
  ON public.order_items(barcode);

NOTIFY pgrst, 'reload schema';
