import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Packet } from "./types";

export interface LoadedPacket {
  packet: Packet;
  sha256: string;
  byteLength: number;
  path: string;
}

const DEFAULT_PATH = path.join("data", "packet.json");

declare global {
  // Cached per process so hot reloads and many requests share one parse.
  var __miraflores_packet: LoadedPacket | undefined;
}

/** Resolve the packet path: env override, else the handoff copy in the repo. */
export function packetPath(): string {
  const configured = process.env.PACKET_PATH?.trim();
  return path.resolve(process.cwd(), configured && configured.length > 0 ? configured : DEFAULT_PATH);
}

/**
 * Read the packet exactly as supplied. The hash is computed over the original
 * bytes, before parsing, so it can be compared with the handoff manifest.
 */
export function loadPacket(filePath = packetPath()): LoadedPacket {
  const cached = globalThis.__miraflores_packet;
  if (cached && cached.path === filePath) return cached;
  const bytes = readFileSync(filePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const packet = JSON.parse(bytes.toString("utf8")) as Packet;
  const loaded: LoadedPacket = { packet, sha256, byteLength: bytes.length, path: filePath };
  globalThis.__miraflores_packet = loaded;
  return loaded;
}

/** Build fast lookup maps for a packet. Memoized per packet object. */
const indexCache = new WeakMap<Packet, PacketIndex>();

export interface PacketIndex {
  documents: Map<string, Packet["documents"][number]>;
  extractedValues: Map<string, Packet["extracted_values"][number]>;
  valuesByPage: Map<string, Packet["extracted_values"][number][]>;
  versions: Map<string, Packet["return_versions"][number]>;
  linesByVersion: Map<string, Map<string, Packet["return_versions"][number]["lines"][number]>>;
  questionnaire: Map<string, Packet["client"]["questionnaire"][number]>;
  messages: Map<string, Packet["client"]["messages"][number]>;
  callNotes: Map<string, Packet["client"]["call_notes"][number]>;
  staff: Map<string, Packet["firm"]["staff"][number]>;
  clientUsers: Map<string, Packet["firm"]["client_users"][number]>;
  people: Map<string, Packet["household"]["people"][number]>;
  timeline: Map<string, Packet["timeline"][number]>;
}

export function indexPacket(packet: Packet): PacketIndex {
  const hit = indexCache.get(packet);
  if (hit) return hit;
  const valuesByPage = new Map<string, Packet["extracted_values"][number][]>();
  for (const ev of packet.extracted_values) {
    const k = `${ev.document_id}#${ev.page}`;
    const list = valuesByPage.get(k);
    if (list) list.push(ev);
    else valuesByPage.set(k, [ev]);
  }
  const index: PacketIndex = {
    documents: new Map(packet.documents.map((d) => [d.id, d])),
    extractedValues: new Map(packet.extracted_values.map((e) => [e.id, e])),
    valuesByPage,
    versions: new Map(packet.return_versions.map((v) => [v.version, v])),
    linesByVersion: new Map(
      packet.return_versions.map((v) => [v.version, new Map(v.lines.map((l) => [l.key, l]))]),
    ),
    questionnaire: new Map(packet.client.questionnaire.map((q) => [q.id, q])),
    messages: new Map(packet.client.messages.map((m) => [m.id, m])),
    callNotes: new Map(packet.client.call_notes.map((c) => [c.id, c])),
    staff: new Map(packet.firm.staff.map((s) => [s.id, s])),
    clientUsers: new Map(packet.firm.client_users.map((c) => [c.id, c])),
    people: new Map(packet.household.people.map((p) => [p.id, p])),
    timeline: new Map(packet.timeline.map((t) => [t.id, t])),
  };
  indexCache.set(packet, index);
  return index;
}
