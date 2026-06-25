CREATE TABLE public.shopify_sku_remaps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  old_sku TEXT NOT NULL,
  new_sku TEXT,
  shopify_variant_id TEXT,
  inventory_item_id TEXT,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX shopify_sku_remaps_old_sku_active_uniq
  ON public.shopify_sku_remaps (old_sku)
  WHERE is_active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_sku_remaps TO authenticated;
GRANT ALL ON public.shopify_sku_remaps TO service_role;

ALTER TABLE public.shopify_sku_remaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shopify_sku_remaps ops read"
  ON public.shopify_sku_remaps FOR SELECT
  TO authenticated
  USING (public.can_ops(auth.uid()));

CREATE POLICY "shopify_sku_remaps ops insert"
  ON public.shopify_sku_remaps FOR INSERT
  TO authenticated
  WITH CHECK (public.can_ops(auth.uid()));

CREATE POLICY "shopify_sku_remaps ops update"
  ON public.shopify_sku_remaps FOR UPDATE
  TO authenticated
  USING (public.can_ops(auth.uid()))
  WITH CHECK (public.can_ops(auth.uid()));

CREATE POLICY "shopify_sku_remaps ops delete"
  ON public.shopify_sku_remaps FOR DELETE
  TO authenticated
  USING (public.can_ops(auth.uid()));

CREATE TRIGGER update_shopify_sku_remaps_updated_at
  BEFORE UPDATE ON public.shopify_sku_remaps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();