-- Update default local order costs to the fixed Mansouj rules.
-- Shopify is not touched. Cancelled orders are intentionally excluded because
-- they may carry real return/shipping costs entered manually.
--
-- Rules:
-- - Shipping Cost defaults to 200 EGP per order.
-- - Packaging Cost defaults to 140 EGP per order.
-- - Packaging Cost is not quantity-based.
-- - Nonzero values manually edited through the app are preserved.

WITH touched_costs AS (
  SELECT
    o.id,
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
  WHERE o.order_status <> 'Cancelled'
)
UPDATE public.orders o
SET
  shipping_cost = CASE
    WHEN o.shipping_cost IS NULL OR o.shipping_cost = 0 THEN 200
    WHEN NOT t.shipping_cost_touched THEN 200
    ELSE o.shipping_cost
  END,
  packaging_cost = CASE
    WHEN o.packaging_cost IS NULL OR o.packaging_cost = 0 THEN 140
    WHEN NOT t.packaging_cost_touched THEN 140
    ELSE o.packaging_cost
  END
FROM touched_costs t
WHERE o.id = t.id
  AND o.order_status <> 'Cancelled'
  AND (
    o.shipping_cost IS NULL
    OR o.shipping_cost = 0
    OR o.packaging_cost IS NULL
    OR o.packaging_cost = 0
    OR (NOT t.shipping_cost_touched AND o.shipping_cost <> 200)
    OR (NOT t.packaging_cost_touched AND o.packaging_cost <> 140)
  );
