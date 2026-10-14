/**
 * Server-side masking of sensitive data. Applied to everything that leaves the
 * server for a viewer without clearance, and by default for cleared viewers
 * too: a cleared reviewer reveals one value at a time through a logged command.
 *
 * Two layers: a literal set built from the packet (every SSN, account number,
 * PIN, EFIN and PTIN it contains) and regular expressions as a safety net for
 * text the literal set does not know about.
 */
import type { Packet } from "@/packet/types";

const SSN_RE = /\b(\d{3})-(\d{2})-(\d{4})\b/g;
const PIN_RE = /\b(PIN\s*:?\s*)(\d{4,6})\b/gi;

export interface SensitiveLiteral {
  value: string;
  masked: string;
  kind: "ssn" | "account" | "pin" | "efin" | "ptin" | "ip_pin" | "routing";
}

const literalCache = new WeakMap<Packet, SensitiveLiteral[]>();

function last4(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.slice(-4);
}

export function sensitiveLiterals(packet: Packet): SensitiveLiteral[] {
  const hit = literalCache.get(packet);
  if (hit) return hit;
  const out: SensitiveLiteral[] = [];
  const add = (value: unknown, kind: SensitiveLiteral["kind"]) => {
    if (typeof value !== "string" || value.length < 4) return;
    const masked =
      kind === "ssn" ? `***-**-${last4(value)}` : kind === "account" || kind === "routing" ? `****${last4(value)}` : "*****";
    out.push({ value, masked, kind });
  };
  for (const person of packet.household.people) {
    add(person.ssn, "ssn");
    add(person.ip_pin, "ip_pin");
  }
  const bank = packet.household.bank_account_for_refund_or_payment;
  add(bank?.routing, "routing");
  add(bank?.account, "account");
  const identity = packet.firm.firm_identity;
  add(identity?.efin, "efin");
  add(identity?.ero_pin, "pin");
  for (const ptin of Object.values(identity?.ptins ?? {})) add(ptin, "ptin");
  for (const ev of packet.extracted_values) {
    if (ev.value_type === "ssn") {
      add(ev.value, "ssn");
      add(ev.text_as_read, "ssn");
    }
    if (ev.value_type === "account_number") {
      add(ev.value, "account");
      add(ev.text_as_read, "account");
    }
  }
  const prior = packet.prior_years.return_2024 as { dependents?: { ssn?: string }[] } | undefined;
  for (const d of prior?.dependents ?? []) add(d.ssn, "ssn");
  for (const t of packet.timeline) {
    for (const m of (t.detail ?? "").matchAll(/PIN\s+(\d{4,6})/g)) add(m[1], "pin");
  }
  // Longest first so a value that contains another is masked whole.
  out.sort((a, b) => b.value.length - a.value.length);
  const unique = out.filter((l, i) => out.findIndex((o) => o.value === l.value) === i);
  literalCache.set(packet, unique);
  return unique;
}

export interface Redactor {
  text: (s: string) => string;
  deep: <T>(value: T) => T;
}

const STRUCTURED_KEYS = new Set(["ssn", "ip_pin", "routing", "account", "efin", "ero_pin", "ptins", "ptin"]);

export function makeRedactor(packet: Packet): Redactor {
  const literals = sensitiveLiterals(packet);
  const text = (s: string): string => {
    let out = s;
    for (const l of literals) {
      if (out.includes(l.value)) out = out.split(l.value).join(l.masked);
    }
    out = out.replace(SSN_RE, "***-**-$3").replace(PIN_RE, "$1*****");
    return out;
  };
  const deep = <T>(value: T): T => walk(value, text) as T;
  return { text, deep };
}

function walk(value: unknown, text: (s: string) => string, key?: string): unknown {
  if (typeof value === "string") {
    if (key && STRUCTURED_KEYS.has(key)) return maskStructured(key, value);
    return text(value);
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, text));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "ptins" && v && typeof v === "object") {
        out[k] = Object.fromEntries(Object.keys(v as object).map((id) => [id, "*****"]));
      } else {
        out[k] = walk(v, text, k);
      }
    }
    return out;
  }
  return value;
}

function maskStructured(key: string, value: string): string {
  if (key === "ssn") return `***-**-${last4(value)}`;
  if (key === "routing" || key === "account") return `****${last4(value)}`;
  return "*****";
}

/** Whether a string still contains something that looks sensitive (used by tests). */
export function looksSensitive(s: string, packet: Packet): boolean {
  SSN_RE.lastIndex = 0;
  if (SSN_RE.test(s)) return true;
  return sensitiveLiterals(packet).some((l) => s.includes(l.value));
}
