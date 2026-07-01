import { supabase } from "@/integrations/supabase/client";

type SaveOrderCostsInput = {
  orderId: string;
  shippingCost: number;
  packagingCost: number;
  source: string;
};

export async function saveOrderCosts({
  orderId,
  shippingCost,
  packagingCost,
  source,
}: SaveOrderCostsInput) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Please sign in again.");

  const response = await fetch("/api/orders/update-costs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      order_id: orderId,
      shipping_cost: shippingCost,
      packaging_cost: packagingCost,
      source,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) {
    throw new Error(json.error ?? "Failed to save order costs.");
  }

  return json.order;
}
