
CREATE TABLE IF NOT EXISTS public.shopify_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id text NOT NULL UNIQUE,
  title text NOT NULL,
  handle text,
  vendor text,
  product_type text,
  status text,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  image jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shopify_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_variant_id text NOT NULL UNIQUE,
  shopify_product_id text NOT NULL REFERENCES public.shopify_products(shopify_product_id) ON DELETE CASCADE,
  title text,
  sku text,
  barcode text,
  price numeric(12,2),
  compare_at_price numeric(12,2),
  inventory_item_id text,
  inventory_quantity integer,
  option1 text,
  option2 text,
  option3 text,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shopify_variants_product_idx ON public.shopify_variants(shopify_product_id);
CREATE INDEX IF NOT EXISTS shopify_variants_inventory_item_idx ON public.shopify_variants(inventory_item_id);
CREATE INDEX IF NOT EXISTS shopify_variants_sku_idx ON public.shopify_variants(sku);

CREATE TABLE IF NOT EXISTS public.shopify_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id text NOT NULL UNIQUE,
  sku text,
  tracked boolean,
  unit_cost_amount numeric(12,4),
  unit_cost_currency_code text,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shopify_inventory_items_sku_idx ON public.shopify_inventory_items(sku);

CREATE TABLE IF NOT EXISTS public.shopify_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_location_id text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shopify_inventory_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id text NOT NULL REFERENCES public.shopify_inventory_items(inventory_item_id) ON DELETE CASCADE,
  shopify_location_id text NOT NULL REFERENCES public.shopify_locations(shopify_location_id) ON DELETE CASCADE,
  available integer,
  shopify_updated_at timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inventory_item_id, shopify_location_id)
);
CREATE INDEX IF NOT EXISTS shopify_inventory_levels_item_idx ON public.shopify_inventory_levels(inventory_item_id);
CREATE INDEX IF NOT EXISTS shopify_inventory_levels_location_idx ON public.shopify_inventory_levels(shopify_location_id);

DROP TRIGGER IF EXISTS shopify_products_updated_at ON public.shopify_products;
CREATE TRIGGER shopify_products_updated_at BEFORE UPDATE ON public.shopify_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS shopify_variants_updated_at ON public.shopify_variants;
CREATE TRIGGER shopify_variants_updated_at BEFORE UPDATE ON public.shopify_variants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS shopify_inventory_items_updated_at ON public.shopify_inventory_items;
CREATE TRIGGER shopify_inventory_items_updated_at BEFORE UPDATE ON public.shopify_inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS shopify_locations_updated_at ON public.shopify_locations;
CREATE TRIGGER shopify_locations_updated_at BEFORE UPDATE ON public.shopify_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS shopify_inventory_levels_updated_at ON public.shopify_inventory_levels;
CREATE TRIGGER shopify_inventory_levels_updated_at BEFORE UPDATE ON public.shopify_inventory_levels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT ON public.shopify_products TO authenticated;
GRANT SELECT ON public.shopify_variants TO authenticated;
GRANT SELECT ON public.shopify_inventory_items TO authenticated;
GRANT SELECT ON public.shopify_locations TO authenticated;
GRANT SELECT ON public.shopify_inventory_levels TO authenticated;
GRANT ALL ON public.shopify_products TO service_role;
GRANT ALL ON public.shopify_variants TO service_role;
GRANT ALL ON public.shopify_inventory_items TO service_role;
GRANT ALL ON public.shopify_locations TO service_role;
GRANT ALL ON public.shopify_inventory_levels TO service_role;

ALTER TABLE public.shopify_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_inventory_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shopify products read ops finance" ON public.shopify_products;
CREATE POLICY "shopify products read ops finance" ON public.shopify_products
  FOR SELECT TO authenticated
  USING (public.can_ops(auth.uid()) OR public.has_role(auth.uid(), 'finance'));

DROP POLICY IF EXISTS "shopify variants read ops finance" ON public.shopify_variants;
CREATE POLICY "shopify variants read ops finance" ON public.shopify_variants
  FOR SELECT TO authenticated
  USING (public.can_ops(auth.uid()) OR public.has_role(auth.uid(), 'finance'));

DROP POLICY IF EXISTS "shopify inventory items read ops finance" ON public.shopify_inventory_items;
CREATE POLICY "shopify inventory items read ops finance" ON public.shopify_inventory_items
  FOR SELECT TO authenticated
  USING (public.can_ops(auth.uid()) OR public.has_role(auth.uid(), 'finance'));

DROP POLICY IF EXISTS "shopify locations read ops finance" ON public.shopify_locations;
CREATE POLICY "shopify locations read ops finance" ON public.shopify_locations
  FOR SELECT TO authenticated
  USING (public.can_ops(auth.uid()) OR public.has_role(auth.uid(), 'finance'));

DROP POLICY IF EXISTS "shopify inventory levels read ops finance" ON public.shopify_inventory_levels;
CREATE POLICY "shopify inventory levels read ops finance" ON public.shopify_inventory_levels
  FOR SELECT TO authenticated
  USING (public.can_ops(auth.uid()) OR public.has_role(auth.uid(), 'finance'));

NOTIFY pgrst, 'reload schema';
