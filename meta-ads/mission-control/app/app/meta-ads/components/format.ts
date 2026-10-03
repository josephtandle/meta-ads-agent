// Number and date formatting for the Meta Ads dashboard. Every number on the
// page is formatted here so the account currency is applied in one place.

export type Format = "currency" | "integer" | "percent" | "decimal" | "multiple" | "text";

export function money(value: number | null | undefined, currency: string, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

export function integer(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(2)}%`;
}

export function decimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

export function formatValue(value: unknown, format: Format | string | undefined, currency: string): string {
  if (typeof value === "string") return value;
  const n = typeof value === "number" ? value : null;
  switch (format) {
    case "currency": return money(n, currency);
    case "integer": return integer(n);
    case "percent": return percent(n);
    case "decimal": return decimal(n);
    case "multiple": return n === null ? "n/a" : `${n.toFixed(2)}x`;
    default: return n === null ? "n/a" : String(n);
  }
}

/** "+25%" / "-12%" / "" for a period-over-period change. */
export function changeLabel(change: number | null | undefined): string {
  if (change === null || change === undefined || !Number.isFinite(change)) return "";
  if (Math.abs(change) < 0.05) return "no change";
  return `${change > 0 ? "+" : ""}${change.toFixed(Math.abs(change) >= 10 ? 0 : 1)}%`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
