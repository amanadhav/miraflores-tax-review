/**
 * When a piece of evidence became available to the firm. The replay clock
 * (workspace as-of time) filters evidence by this: a July message is not
 * current evidence on June 23, and the August IRS snapshot does not exist in
 * March even though a March transcript page points at the same record.
 */
import { indexPacket } from "./load";
import { parseRef, resolvePointer } from "./refs";
import type { Packet } from "./types";

/** ISO timestamp at which the referenced record became available, or null when it is timeless. */
export function availableAt(packet: Packet, ref: string): string | null {
  const idx = indexPacket(packet);
  const parsed = parseRef(ref);
  switch (parsed.kind) {
    case "document":
      return idx.documents.get(parsed.id)?.received_at ?? null;
    case "document_page":
      return idx.documents.get(parsed.documentId)?.received_at ?? null;
    case "extracted_value": {
      const ev = idx.extractedValues.get(parsed.id);
      return ev ? (idx.documents.get(ev.document_id)?.received_at ?? null) : null;
    }
    case "questionnaire":
      return idx.questionnaire.get(parsed.id)?.answered_at ?? null;
    case "message":
      return idx.messages.get(parsed.id)?.sent_at ?? null;
    case "call_note":
      return idx.callNotes.get(parsed.id)?.date ?? null;
    case "timeline":
      return idx.timeline.get(parsed.id)?.at ?? null;
    case "version":
      return idx.versions.get(parsed.id)?.computed_at ?? null;
    case "agency": {
      // Snapshots carry their own as_of; notices carry a date; e-file rows carry a date.
      const segments = parsed.pointer.slice(1).split("/");
      if (segments[0] === "irs_account_transcript_2025" && segments[1] !== undefined) {
        const snap = resolvePointer(packet.tax_agency_records, `/irs_account_transcript_2025/${segments[1]}`);
        const asOf = (snap.value as { as_of?: string } | undefined)?.as_of;
        return asOf ? `${asOf}T00:00:00Z` : null;
      }
      if (segments[0] === "ftb_account") {
        const asOf = (packet.tax_agency_records.ftb_account as { as_of?: string } | undefined)?.as_of;
        return asOf ? `${asOf}T00:00:00Z` : null;
      }
      if (segments[0] === "notices" && segments[1] !== undefined) {
        const n = resolvePointer(packet.tax_agency_records, `/notices/${segments[1]}`);
        const dated = (n.value as { dated?: string } | undefined)?.dated;
        return dated ? `${dated}T00:00:00Z` : null;
      }
      if (segments[0] === "efile" && segments[1] !== undefined) {
        const e = resolvePointer(packet.tax_agency_records, `/efile/${segments[1]}`);
        return (e.value as { date?: string } | undefined)?.date ?? null;
      }
      return null;
    }
    default:
      return null;
  }
}

export function isAvailable(packet: Packet, ref: string, asOfIso: string): boolean {
  const at = availableAt(packet, ref);
  if (!at) return true;
  return new Date(at).getTime() <= new Date(asOfIso).getTime();
}

export interface AvailabilityCheck {
  ref: string;
  availableAt: string | null;
  available: boolean;
}

export function checkAvailability(packet: Packet, refs: string[], asOfIso: string): AvailabilityCheck[] {
  return refs.map((ref) => {
    const at = availableAt(packet, ref);
    return { ref, availableAt: at, available: at ? new Date(at).getTime() <= new Date(asOfIso).getTime() : true };
  });
}
