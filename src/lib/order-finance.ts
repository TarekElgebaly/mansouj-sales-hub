export function isCancelledOrder(order: { order_status?: string | null } | null | undefined) {
  return order?.order_status === "Cancelled";
}

export function financeNumber(order: Record<string, unknown>, key: string) {
  if (isCancelledOrder(order)) return 0;
  const n = Number(order[key] ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function financeNullable(order: Record<string, unknown>, key: string) {
  if (isCancelledOrder(order)) return 0;
  const value = order[key];
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}
