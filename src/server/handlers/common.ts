import { areaForDocument, areaForLine } from "@/domain/areas";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef } from "@/packet/refs";
import { CommandError, type HandlerContext } from "../commands";

/** Review area for any reference: lines map by form, documents by type, the rest to intake. */
export function subjectArea(hc: Pick<HandlerContext, "ctx">, subjectRef: string): string {
  const parsed = parseRef(subjectRef);
  const packet = hc.ctx.packet.packet;
  const idx = indexPacket(packet);
  if (parsed.kind === "line") {
    const line = idx.linesByVersion.get(hc.ctx.workspace.activeVersion)?.get(parsed.key);
    if (!line) throw new CommandError("not_found", `${subjectRef} is not a line in ${hc.ctx.workspace.activeVersion}.`);
    return areaForLine(line.key, line.form);
  }
  if (parsed.kind === "document" || parsed.kind === "document_page") {
    const doc = idx.documents.get(parsed.kind === "document" ? parsed.id : parsed.documentId);
    if (!doc) throw new CommandError("not_found", `${subjectRef} is not in the packet.`);
    return areaForDocument(doc.document_type, doc.issuer);
  }
  if (parsed.kind === "extracted_value") {
    const ev = idx.extractedValues.get(parsed.id);
    const doc = ev ? idx.documents.get(ev.document_id) : undefined;
    if (!doc) throw new CommandError("not_found", `${subjectRef} is not in the packet.`);
    return areaForDocument(doc.document_type, doc.issuer);
  }
  if (parsed.kind === "workpaper") return "intake_and_engagement";
  const resolved = resolveRef(packet, subjectRef, { version: hc.ctx.workspace.activeVersion });
  if (!resolved.found) throw new CommandError("not_found", `${subjectRef} does not resolve.`);
  return "intake_and_engagement";
}
