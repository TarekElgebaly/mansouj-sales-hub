-- Shopify fulfillment_status = fulfilled means processed/shipped, not customer delivered.
-- Correct previously synced Shopify rows that were marked Delivered by the old mapping.
-- Rows with the local delivered flag are preserved as manual/actual delivered records.

UPDATE public.orders
SET
  order_status = 'Shipped',
  delivered = false
WHERE shopify_order_id IS NOT NULL
  AND order_status = 'Delivered'
  AND COALESCE(delivered, false) = false;

NOTIFY pgrst, 'reload schema';
