export const egp = (n: number | null | undefined) =>
  new Intl.NumberFormat("en-EG", { style: "currency", currency: "EGP", maximumFractionDigits: 0 }).format(Number(n ?? 0));

export const fmtDate = (d: string | null | undefined) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return d;
  }
};

export const fmtDateTime = (d: string | null | undefined) => {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return d;
  }
};

export const CONFIRMATION_STATUSES = [
  "Fresh Calls", "Confirmed", "No Answer", "Call Back", "Cancel", "Wrong Number", "Duplicate", "Pending",
] as const;

export const ORDER_STATUSES = [
  "New", "Ready", "Uploaded to Shipping", "Shipped", "Delivered", "Cancelled", "Cancel with confirmation", "RTO", "On Hold",
] as const;

export const INVENTORY_STATUSES = ["In Stock", "Low Stock", "Out of Stock", "Discontinued"] as const;

export const statusTone = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (s) {
    case "Delivered":
    case "Confirmed":
    case "In Stock":
      return "default";
    case "Cancelled":
    case "Cancel":
    case "RTO":
    case "Out of Stock":
    case "Wrong Number":
      return "destructive";
    case "Low Stock":
    case "On Hold":
    case "Call Back":
    case "Pending":
    case "No Answer":
      return "outline";
    default:
      return "secondary";
  }
};
