export function money(value: unknown, opts: { signed?: boolean; cents?: boolean } = {}): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return value === null || value === undefined ? "blank" : String(value);
  const abs = Math.abs(value);
  const digits = opts.cents || Math.round(abs) !== abs ? 2 : 0;
  const text = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (value < 0) return `(${text})`;
  return opts.signed && value > 0 ? `+${text}` : text;
}

export function signed(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "unknown";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "unknown";
  if (n === 0) return "0";
  const text = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return n < 0 ? `-${text}` : `+${text}`;
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function humanize(id: string): string {
  return id.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());
}
