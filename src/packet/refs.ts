/**
 * Typed reference parsing and resolution for every reference format the packet
 * README defines, plus the workpaper's own record references. Resolution never
 * throws for a bad reference: it returns `found: false` so callers can render
 * an unresolved-evidence state and raise a finding.
 */
import type { Packet } from "./types";
import { indexPacket } from "./load";

export type ParsedRef =
  | { kind: "extracted_value"; id: string }
  | { kind: "document"; id: string }
  | { kind: "document_page"; documentId: string; page: number }
  | { kind: "questionnaire"; id: string }
  | { kind: "message"; id: string }
  | { kind: "call_note"; id: string }
  | { kind: "prior_year"; pointer: string }
  | { kind: "agency"; pointer: string }
  | { kind: "asset"; id: string }
  | { kind: "household"; id: string }
  | { kind: "parameter"; name: string }
  | { kind: "fx"; rate: string }
  | { kind: "timeline"; id: string }
  | { kind: "version"; id: string }
  | { kind: "line"; key: string; form: string }
  | { kind: "workpaper"; table: WorkpaperTable; id: string }
  | { kind: "unknown"; raw: string };

export type WorkpaperTable = "adjustment" | "anchor" | "finding" | "verification" | "signoff" | "request";

const LINE_KEY = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Z])?)\.(.+)$/;

export function parseRef(raw: string): ParsedRef {
  const ref = raw.trim();
  let m: RegExpMatchArray | null;
  if (/^ev-\d+$/.test(ref)) return { kind: "extracted_value", id: ref };
  if (/^D\d{2}$/.test(ref)) return { kind: "document", id: ref };
  if ((m = ref.match(/^doc:(D\d{2})#page(\d+)$/))) {
    return { kind: "document_page", documentId: m[1], page: Number(m[2]) };
  }
  if (/^qa-\d+$/.test(ref)) return { kind: "questionnaire", id: ref };
  if (/^msg-\d+$/.test(ref)) return { kind: "message", id: ref };
  if (/^call-\d+$/.test(ref)) return { kind: "call_note", id: ref };
  if ((m = ref.match(/^py:(\/.*)$/))) return { kind: "prior_year", pointer: m[1] };
  if ((m = ref.match(/^agency:(\/.*)$/))) return { kind: "agency", pointer: m[1] };
  if ((m = ref.match(/^asset:(.+)$/))) return { kind: "asset", id: m[1] };
  if ((m = ref.match(/^household:(.+)$/))) return { kind: "household", id: m[1] };
  if ((m = ref.match(/^ref:param\.(.+)$/))) return { kind: "parameter", name: m[1] };
  if ((m = ref.match(/^ref:fx\.SEK\.(.+)$/))) return { kind: "fx", rate: m[1] };
  if ((m = ref.match(/^timeline:(.+)$/))) return { kind: "timeline", id: m[1] };
  if (/^v\d+$/.test(ref)) return { kind: "version", id: ref };
  if ((m = ref.match(/^(adjustment|anchor|finding|verification|signoff|request):(.+)$/))) {
    return { kind: "workpaper", table: m[1] as WorkpaperTable, id: m[2] };
  }
  if ((m = ref.match(LINE_KEY))) return { kind: "line", key: ref, form: m[1] };
  return { kind: "unknown", raw: ref };
}

/** RFC 6901 JSON Pointer evaluation. Keys containing dots are whole names. */
export function resolvePointer(root: unknown, pointer: string): { found: boolean; value: unknown } {
  if (pointer === "" || pointer === "/") return { found: true, value: root };
  if (!pointer.startsWith("/")) return { found: false, value: undefined };
  let current: unknown = root;
  for (const rawToken of pointer.slice(1).split("/")) {
    const token = rawToken.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(token)) return { found: false, value: undefined };
      const i = Number(token);
      if (i >= current.length) return { found: false, value: undefined };
      current = current[i];
    } else if (current !== null && typeof current === "object") {
      if (!Object.prototype.hasOwnProperty.call(current, token)) return { found: false, value: undefined };
      current = (current as Record<string, unknown>)[token];
    } else {
      return { found: false, value: undefined };
    }
  }
  return { found: true, value: current };
}

export interface ResolvedRef {
  ref: string;
  parsed: ParsedRef;
  found: boolean;
  /** Plain-language label suitable for the UI. */
  label: string;
  /** Where the reference lives, for navigation. */
  location?: { documentId?: string; page?: number; version?: string; lineKey?: string };
  /** The resolved data, unredacted. Callers must redact before sending to a browser. */
  value?: unknown;
  /** Raw value the pipeline read when the ref is an extracted value. */
  note?: string;
}

export interface ResolveOptions {
  /** Engine version used to resolve line keys and version-scoped assets. */
  version: string;
}

export function resolveRef(packet: Packet, raw: string, options: ResolveOptions): ResolvedRef {
  const idx = indexPacket(packet);
  const parsed = parseRef(raw);
  const missing = (label: string): ResolvedRef => ({ ref: raw, parsed, found: false, label });
  switch (parsed.kind) {
    case "extracted_value": {
      const ev = idx.extractedValues.get(parsed.id);
      if (!ev) return missing(`Extracted value ${parsed.id} (not in packet)`);
      const doc = idx.documents.get(ev.document_id);
      return {
        ref: raw,
        parsed,
        found: true,
        label: `${ev.label} (${doc?.title ?? ev.document_id}, page ${ev.page})`,
        location: { documentId: ev.document_id, page: ev.page },
        value: ev,
      };
    }
    case "document": {
      const doc = idx.documents.get(parsed.id);
      if (!doc) return missing(`Document ${parsed.id} (not in packet)`);
      return { ref: raw, parsed, found: true, label: doc.title, location: { documentId: doc.id, page: 1 }, value: doc };
    }
    case "document_page": {
      const doc = idx.documents.get(parsed.documentId);
      const page = doc?.pages.find((p) => p.page === parsed.page);
      if (!doc || !page) return missing(`${parsed.documentId} page ${parsed.page} (not in packet)`);
      return {
        ref: raw,
        parsed,
        found: true,
        label: `${doc.title}, page ${parsed.page}`,
        location: { documentId: doc.id, page: parsed.page },
        value: page,
      };
    }
    case "questionnaire": {
      const q = idx.questionnaire.get(parsed.id);
      if (!q) return missing(`Questionnaire answer ${parsed.id} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Client answer: ${q.question}`, value: q };
    }
    case "message": {
      const m = idx.messages.get(parsed.id);
      if (!m) return missing(`Message ${parsed.id} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Message from ${m.from} on ${m.sent_at.slice(0, 10)}`, value: m };
    }
    case "call_note": {
      const c = idx.callNotes.get(parsed.id);
      if (!c) return missing(`Call note ${parsed.id} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Call on ${c.date.slice(0, 10)} with ${c.participants.join(", ")}`, value: c };
    }
    case "prior_year": {
      const r = resolvePointer(packet.prior_years, parsed.pointer);
      if (!r.found) return missing(`Prior-year record ${parsed.pointer} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Prior-year record ${describePointer(parsed.pointer)}`, value: r.value };
    }
    case "agency": {
      const r = resolvePointer(packet.tax_agency_records, parsed.pointer);
      if (!r.found) return missing(`Agency record ${parsed.pointer} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Agency record ${describePointer(parsed.pointer)}`, value: r.value };
    }
    case "asset": {
      const version = idx.versions.get(options.version);
      const asset =
        version?.assets.find((a) => a.asset_id === parsed.id) ??
        (packet.prior_years.asset_records as { asset_id: string }[] | undefined)?.find((a) => a.asset_id === parsed.id);
      if (!asset) return missing(`Asset ${parsed.id} (not in ${options.version} or prior records)`);
      const description = (asset as { description?: string }).description ?? parsed.id;
      return { ref: raw, parsed, found: true, label: `Asset ${description}`, location: { version: options.version }, value: asset };
    }
    case "household": {
      const p = idx.people.get(parsed.id);
      if (!p) return missing(`Household member ${parsed.id} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `${p.name} (${p.role})`, value: p };
    }
    case "parameter": {
      const params = packet.engine_reference.parameters;
      if (!Object.prototype.hasOwnProperty.call(params, parsed.name)) return missing(`Engine parameter ${parsed.name} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Engine parameter ${parsed.name}`, value: params[parsed.name] };
    }
    case "fx": {
      const fx = (packet.engine_reference.parameters.fx as { SEK?: Record<string, number> } | undefined)?.SEK;
      if (!fx || !(parsed.rate in fx)) return missing(`Exchange rate SEK ${parsed.rate} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `SEK per USD, ${parsed.rate.replace("_", " ")}`, value: fx[parsed.rate] };
    }
    case "timeline": {
      const t = idx.timeline.get(parsed.id);
      if (!t) return missing(`Timeline event ${parsed.id} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Timeline: ${t.event.replace(/_/g, " ")} on ${t.at.slice(0, 10)}`, value: t };
    }
    case "version": {
      const v = idx.versions.get(parsed.id);
      if (!v) return missing(`Return version ${parsed.id} (not in packet)`);
      return { ref: raw, parsed, found: true, label: `Return version ${v.version} computed ${v.computed_at.slice(0, 10)}`, location: { version: v.version }, value: { version: v.version, computed_at: v.computed_at, trigger: v.trigger } };
    }
    case "line": {
      const lines = idx.linesByVersion.get(options.version);
      const line = lines?.get(parsed.key);
      if (!line) return missing(`Return line ${parsed.key} (not in ${options.version})`);
      return { ref: raw, parsed, found: true, label: `${line.form} line ${line.line}: ${line.label}`, location: { version: options.version, lineKey: line.key }, value: line };
    }
    case "workpaper":
      // Workpaper records live in the database; the server resolves them separately.
      return { ref: raw, parsed, found: true, label: `${parsed.table} ${parsed.id}` };
    case "unknown":
      return missing(`Unrecognized reference ${raw}`);
  }
}

function describePointer(pointer: string): string {
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(" > ");
}

/** True when a reference format is one the packet README defines. */
export function isPacketRef(raw: string): boolean {
  const k = parseRef(raw).kind;
  return k !== "unknown" && k !== "workpaper";
}
