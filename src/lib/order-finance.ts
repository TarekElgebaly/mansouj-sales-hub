export function isCancelledOrder(order: { order_status?: string | null } | null | undefined) {
  return order?.order_status === "Cancelled";
}

export function financeNumber(order: Record<string, unknown>, key: string) {
  if (isCancelledOrder(order)) {
    if (key === "shipping_cost" || key === "packaging_cost") {
      const n = Number(order[key] ?? 0);
      return Number.isFinite(n) ? n : 0;
    }
    if (key === "net_profit") {
      const shipping = Number(order.shipping_cost ?? 0);
      const packaging = Number(order.packaging_cost ?? 0);
      return -(Number.isFinite(shipping) ? shipping : 0) - (Number.isFinite(packaging) ? packaging : 0);
    }
    return 0;
  }
  const n = Number(order[key] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function financeNullable(order: Record<string, unknown>, key: string) {
  if (isCancelledOrder(order)) {
    if (key === "shipping_cost" || key === "packaging_cost") {
      const n = Number(order[key] ?? 0);
      return Number.isFinite(n) && n !== 0 ? n : null;
    }
    if (key === "net_profit") {
      const net = financeNumber(order, "net_profit");
      return net === 0 ? null : net;
    }
    return 0;
  }
  const value = order[key];
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}
