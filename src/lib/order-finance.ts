import { calculateKashierFees } from "@/lib/kashier-fees";

export function isCancelledOrder(order: { order_status?: string | null } | null | undefined) {
  return order?.order_status === "Cancelled";
}

function rawNumber(order: Record<string, unknown>, key: string) {
  const n = Number(order[key] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function financeNumber(order: Record<string, unknown>, key: string): number {
  if (isCancelledOrder(order)) {
    return 0;
  }
  if (key === "net_profit") {
    const selling = rawNumber(order, "total_selling_price");
    const cost = rawNumber(order, "items_cost");
    const shipping = rawNumber(order, "shipping_cost");
    const packaging = rawNumber(order, "packaging_cost");
    const kashierFees = calculateKashierFees(order, selling);
    return selling - cost - shipping - packaging - kashierFees;
  }
  return rawNumber(order, key);
}

export function financeNullable(order: Record<string, unknown>, key: string): number | null {
  if (isCancelledOrder(order)) {
    return 0;
  }
  if (key === "net_profit") {
    const net = financeNumber(order, "net_profit");
    return net === 0 ? null : net;
  }
  const value = order[key];
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}
