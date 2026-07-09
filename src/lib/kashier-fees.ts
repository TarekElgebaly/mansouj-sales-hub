const KASHIER_FEE_RATE = 0.022 * 1.14;

function text(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(" ");
  return String(value ?? "");
}

function paymentText(order: Record<string, unknown>) {
  return [
    order.payment_gateway,
    order.payment_method,
    order.payment_method_title,
    order.gateway,
    order.payment_gateway_names,
    order.tags,
  ]
    .map(text)
    .join(" ")
    .toLowerCase();
}

export function isKashierPayment(order: Record<string, unknown>) {
  const value = paymentText(order);
  if (!value.trim()) return false;

  if (
    /\b(cod|cash on delivery)\b/.test(value) ||
    value.includes("cash on delivery") ||
    value.includes("الدفع عند الاستلام")
  ) {
    return false;
  }

  return (
    value.includes("kashier") ||
    value.includes("card") ||
    value.includes("wallet") ||
    value.includes("online payment") ||
    value.includes("installment") ||
    value.includes("visa") ||
    value.includes("mastercard")
  );
}

export function calculateKashierFees(
  order: Record<string, unknown>,
  totalOverride?: number | null,
) {
  if (!isKashierPayment(order)) return 0;
  const total = Number(totalOverride ?? order.total_selling_price ?? 0);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Number((total * KASHIER_FEE_RATE).toFixed(2));
}
