export type OrderStatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export function getOrderStatusTone(status: string): OrderStatusTone {
  switch (status.trim().toLowerCase()) {
    case "paid":
    case "done":
    case "completed":
      return "success";
    case "awaiting_payment":
    case "pending":
    case "expired":
    case "refund_pending":
      return "warning";
    case "cancelled":
    case "payment_failed":
    case "failed":
    case "blocked":
    case "refund_rejected":
      return "danger";
    case "refund_sent":
      return "info";
    default:
      return "neutral";
  }
}

export function getOrderStatusColor(status: string, isDark: boolean): string {
  const tone = getOrderStatusTone(status);
  if (tone === "success") return isDark ? "bg-emerald-500/15 text-emerald-300" : "bg-emerald-100 text-emerald-800";
  if (tone === "warning") return isDark ? "bg-orange-500/15 text-orange-300" : "bg-orange-100 text-orange-800";
  if (tone === "danger") return isDark ? "bg-rose-500/15 text-rose-300" : "bg-rose-100 text-rose-800";
  if (tone === "info") return isDark ? "bg-sky-500/15 text-sky-300" : "bg-sky-100 text-sky-800";
  return isDark ? "bg-white/10 text-slate-300" : "bg-slate-100 text-slate-700";
}

export function getOrderStatusPanelColor(status: string, isDark: boolean): string {
  const tone = getOrderStatusTone(status);
  if (tone === "success") return isDark ? "border-emerald-500/20 bg-emerald-500/10" : "border-emerald-200 bg-emerald-50";
  if (tone === "warning") return isDark ? "border-orange-500/20 bg-orange-500/10" : "border-orange-200 bg-orange-50";
  if (tone === "danger") return isDark ? "border-rose-500/20 bg-rose-500/10" : "border-rose-200 bg-rose-50";
  if (tone === "info") return isDark ? "border-sky-500/20 bg-sky-500/10" : "border-sky-200 bg-sky-50";
  return isDark ? "border-white/10 bg-white/5" : "border-slate-200 bg-slate-50";
}
