import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  indexProductMedia,
  mediaForLineItem,
  normalizeProductKey,
  ShopifyVariantLike,
  variantIdFromSku,
} from "@/lib/product-media";

const VARIANT_SELECT =
  "shopify_variant_id,shopify_product_id,sku,barcode,title,option1,option2,option3,raw,shopify_products(title,product_type,image,raw)";

export function useProductMedia<T extends {
  id?: string;
  sku?: string | null;
  product_name?: string | null;
  variant?: string | null;
  shopify_variant_id?: string | null;
}>(
  items: T[] | null | undefined,
) {
  const keys = useMemo(() => {
    const source = items ?? [];
    const skus = Array.from(
      new Set(
        source
          .map((item) => String(item.sku ?? "").trim())
          .filter(Boolean)
          .filter((sku) => !variantIdFromSku(sku)),
      ),
    );
    const variantIds = Array.from(
      new Set(
        source
          .flatMap((item) => [item.shopify_variant_id, variantIdFromSku(item.sku)])
          .filter(Boolean) as string[],
      ),
    );
    return { skus, variantIds };
  }, [items]);

  const { data } = useQuery({
    queryKey: ["product-media", keys.skus, keys.variantIds],
    enabled: keys.skus.length > 0 || keys.variantIds.length > 0,
    queryFn: async () => {
      const rows = new Map<string, ShopifyVariantLike>();

      const addRows = (records: ShopifyVariantLike[] | null | undefined) => {
        for (const record of records ?? []) {
          const key = record.shopify_variant_id ?? `${record.sku ?? ""}:${record.barcode ?? ""}`;
          if (key) rows.set(String(key), record);
        }
      };

      if (keys.variantIds.length) {
        const { data } = await (supabase as any)
          .from("shopify_variants")
          .select(VARIANT_SELECT)
          .in("shopify_variant_id", keys.variantIds);
        addRows(data);
      }

      if (keys.skus.length) {
        const { data: skuRows } = await (supabase as any)
          .from("shopify_variants")
          .select(VARIANT_SELECT)
          .in("sku", keys.skus);
        addRows(skuRows);

        const { data: barcodeRows } = await (supabase as any)
          .from("shopify_variants")
          .select(VARIANT_SELECT)
          .in("barcode", keys.skus);
        addRows(barcodeRows);
      }

      return Array.from(rows.values());
    },
  });

  return useMemo(() => {
    const index = indexProductMedia((data ?? []) as ShopifyVariantLike[]);
    const byItemId = new Map<string, ReturnType<typeof mediaForLineItem>>();
    for (const item of items ?? []) {
      if (!item.id) continue;
      byItemId.set(item.id, mediaForLineItem(item, index));
    }
    const bySkuNormalized = new Map<string, ReturnType<typeof mediaForLineItem>>();
    for (const item of items ?? []) {
      const media = mediaForLineItem(item, index);
      if (item.sku && media) bySkuNormalized.set(normalizeProductKey(item.sku), media);
    }
    return { byItemId, bySkuNormalized };
  }, [data, items]);
}
