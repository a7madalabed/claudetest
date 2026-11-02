import { formatMoney } from "@ledgerly/shared";

/** Axis ticks: in full under 10,000 ($2,000), compact above ($12K) — one style per axis. */
export function axisMoney(minor: number, currency: string, compact: boolean) {
  const major = minor / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 0,
  }).format(major);
}

/** Full precision, for tooltips and tables. */
export const fullMoney = (minor: number, currency: string) => formatMoney(minor, currency);

/** "$548" — whole units, for rough figures like a monthly pace (cents would be false precision). */
export const wholeMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    minor / 100,
  );

/** "$12.3K" for stat tiles and direct labels where space is tight. */
export const shortMoney = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(minor / 100);

const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
export const shortMonth = (yearMonth: string) =>
  monthShort.format(new Date(`${yearMonth}-01T00:00:00Z`));
export const longMonth = (yearMonth: string) =>
  monthLong.format(new Date(`${yearMonth}-01T00:00:00Z`));
