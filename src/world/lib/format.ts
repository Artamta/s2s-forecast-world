const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function utc(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

export function formatLatitude(latitude: number): string {
  if (Math.abs(latitude) < 0.005) return "0°";
  return `${Math.abs(latitude).toFixed(Number.isInteger(latitude) ? 0 : 2)}°${latitude > 0 ? "N" : "S"}`;
}

export function formatLongitude(longitude: number): string {
  const wrapped = ((((longitude + 180) % 360) + 360) % 360) - 180;
  if (Math.abs(wrapped) < 0.005) return "0°";
  if (Math.abs(Math.abs(wrapped) - 180) < 0.005) return "180°";
  return `${Math.abs(wrapped).toFixed(Number.isInteger(wrapped) ? 0 : 2)}°${wrapped > 0 ? "E" : "W"}`;
}

export function formatDay(isoDay: string): string {
  return DAY_MONTH.format(utc(isoDay));
}

export function formatFullDate(isoDay: string): string {
  return FULL_DATE.format(utc(isoDay));
}

export function formatRange(start: string, end: string): string {
  const [first, last] = [utc(start), utc(end)];
  if (first.getUTCMonth() === last.getUTCMonth()) {
    return `${first.getUTCDate()}–${DAY_MONTH.format(last)}`;
  }
  return `${DAY_MONTH.format(first)} – ${DAY_MONTH.format(last)}`;
}

export function addDays(isoDay: string, days: number): string {
  const day = utc(isoDay);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function formatNumber(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "–";
  const text = value.toFixed(digits);
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}

export function formatSigned(value: number, digits: number): string {
  if (!Number.isFinite(value)) return "–";
  const text = formatNumber(value, digits);
  return value > 0 ? `+${text}` : text;
}

export function digitsFor(units: string): number {
  return units.startsWith("mm") || units === "%" ? 0 : 1;
}
