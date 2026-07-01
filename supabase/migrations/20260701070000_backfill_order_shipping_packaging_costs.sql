-- Backfill operational costs for existing local orders.
-- Shopify is not touched. Cancelled orders are intentionally excluded because
-- their shipping/packaging costs may be manually tracked return costs.

WITH order_cost_defaults AS (
  SELECT
    o.id,
    COALESCE(SUM(COALESCE(oi.quantity, 0)), 0) AS total_item_quantity,
    EXISTS (
      SELECT 1
      FROM public.order_activity a
      WHERE a.order_id = o.id
        AND (
          a.action = 'update_costs'
          OR COALESCE(a.details, '{}'::jsonb) ? 'shipping_cost'
          OR COALESCE(a.details, '{}'::jsonb) ? 'new_shipping_cost'
        )
    ) AS shipping_cost_touched,
    EXISTS (
      SELECT 1
      FROM public.order_activity a
      WHERE a.order_id = o.id
        AND (
          a.action = 'update_costs'
          OR COALESCE(a.details, '{}'::jsonb) ? 'packaging_cost'
          OR COALESCE(a.details, '{}'::jsonb) ? 'new_packaging_cost'
        )
    ) AS packaging_cost_touched
  FROM public.orders o
  LEFT JOIN public.order_items oi ON oi.order_id = o.id
  WHERE o.order_status <> 'Cancelled'
  GROUP BY o.id
)
UPDATE public.orders o
SET
  shipping_cost = CASE
    WHEN (o.shipping_cost IS NULL OR o.shipping_cost = 0)
      AND NOT d.shipping_cost_touched
      THEN 200
    ELSE o.shipping_cost
  END,
  packaging_cost = CASE
    WHEN (o.packaging_cost IS NULL OR o.packaging_cost = 0)
      AND NOT d.packaging_cost_touched
      THEN d.total_item_quantity * 100
    ELSE o.packaging_cost
  END
FROM order_cost_defaults d
WHERE o.id = d.id
  AND o.order_status <> 'Cancelled'
  AND (
    ((o.shipping_cost IS NULL OR o.shipping_cost = 0) AND NOT d.shipping_cost_touched)
    OR ((o.packaging_cost IS NULL OR o.packaging_cost = 0) AND NOT d.packaging_cost_touched)
  );
