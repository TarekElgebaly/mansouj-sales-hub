-- Keep Shopify inventory quantity names separate.
-- Available can be negative when orders are committed; valuation must use on-hand.

ALTER TABLE public.shopify_inventory_levels
  ADD COLUMN IF NOT EXISTS available_quantity integer,
  ADD COLUMN IF NOT EXISTS on_hand integer,
  ADD COLUMN IF NOT EXISTS on_hand_quantity integer,
  ADD COLUMN IF NOT EXISTS committed_quantity integer,
  ADD COLUMN IF NOT EXISTS unavailable_quantity integer,
  ADD COLUMN IF NOT EXISTS incoming_quantity integer;

UPDATE public.shopify_inventory_levels
SET
  available_quantity = COALESCE(available_quantity, available),
  on_hand_quantity = COALESCE(on_hand_quantity, on_hand)
WHERE available_quantity IS NULL
   OR on_hand_quantity IS NULL;

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS committed_quantity integer,
  ADD COLUMN IF NOT EXISTS unavailable_quantity integer,
  ADD COLUMN IF NOT EXISTS incoming_quantity integer;

NOTIFY pgrst, 'reload schema';
