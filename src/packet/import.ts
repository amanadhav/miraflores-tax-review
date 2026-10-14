import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import type { LoadedPacket } from "./load";
import type { Packet } from "./types";

export interface PacketCounts {
  documents: number;
  pages: number;
  extractedValues: number;
  lines: Record<string, number>;
  edges: number;
}

export interface ImportResult {
  packetId: string;
  imported: boolean;
  counts: PacketCounts;
}

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Import a packet into the immutable packet tables. Keyed by the SHA-256 of
 * the original bytes, so importing the same file twice is a no-op and never
 * duplicates records. The original JSON is stored whole alongside the
 * normalized tables.
 */
export async function importPacket(db: Db, loaded: LoadedPacket): Promise<ImportResult> {
  const packetId = loaded.sha256;
  const existing = await db.select({ id: t.packets.id }).from(t.packets).where(eq(t.packets.id, packetId));
  if (existing.length > 0) {
    return { packetId, imported: false, counts: await countPacket(db, packetId) };
  }

  const p = loaded.packet;
  await db.transaction(async (tx) => {
    await tx.insert(t.packets).values({
      id: packetId,
      name: p.packet.name,
      version: p.packet.version,
      generated: p.packet.generated,
      clientId: p.packet.client_id,
      byteLength: loaded.byteLength,
      raw: p,
    });

    for (const rows of chunk(p.documents, 100)) {
      await tx.insert(t.documents).values(
        rows.map((d) => ({
          packetId,
          id: d.id,
          title: d.title,
          documentType: d.document_type,
          issuer: d.issuer,
          belongsTo: d.belongs_to,
          taxYear: d.tax_year,
          receivedAt: d.received_at,
          uploadedBy: d.uploaded_by,
          fileName: d.file_name,
          pageCount: d.page_count,
          markedCorrected: d.marked_corrected ?? null,
          extractionStatus: d.extraction.status,
          extractionValues: d.extraction.values,
          extractionReason: d.extraction.reason,
        })),
      );
    }

    const pages = p.documents.flatMap((d) =>
      d.pages.map((pg) => ({ packetId, documentId: d.id, page: pg.page, printedContent: pg.printed_content })),
    );
    for (const rows of chunk(pages, 200)) await tx.insert(t.documentPages).values(rows);

    for (const rows of chunk(p.extracted_values, 400)) {
      await tx.insert(t.extractedValues).values(
        rows.map((e) => ({
          packetId,
          id: e.id,
          documentId: e.document_id,
          page: e.page,
          field: e.field,
          label: e.label,
          value: e.value,
          valueType: e.value_type,
          textAsRead: e.text_as_read,
          position: e.position,
          confidence: e.confidence,
        })),
      );
    }

    for (const v of p.return_versions) {
      for (const rows of chunk(v.lines, 400)) {
        await tx.insert(t.returnLines).values(
          rows.map((l) => ({
            packetId,
            version: v.version,
            key: l.key,
            jurisdiction: l.jurisdiction,
            form: l.form,
            line: l.line,
            label: l.label,
            value: l.value,
            rule: l.rule,
            inputs: l.inputs,
            sources: l.sources,
            note: l.note ?? null,
          })),
        );
      }
    }

    const edges = buildEngineEdges(p).map((e) => ({ ...e, packetId, workspaceId: null, origin: "engine" }));
    for (const rows of chunk(edges, 500)) await tx.insert(t.referenceEdges).values(rows);
  });

  return { packetId, imported: true, counts: await countPacket(db, packetId) };
}

interface EdgeSeed {
  version: string | null;
  fromRef: string;
  toRef: string;
  relation: string;
}

/**
 * The engine's reference graph. Direction: `from` is used by `to`. Lines use
 * their input lines and their evidence sources; corrected documents supersede
 * originals; prior-year lines and assets record their own sources.
 */
export function buildEngineEdges(p: Packet): EdgeSeed[] {
  const edges: EdgeSeed[] = [];
  for (const v of p.return_versions) {
    for (const l of v.lines) {
      for (const input of l.inputs) edges.push({ version: v.version, fromRef: input, toRef: l.key, relation: "computes" });
      for (const src of l.sources) edges.push({ version: v.version, fromRef: src, toRef: l.key, relation: "supports" });
    }
    for (const superseded of v.documents_superseded) {
      const replacement = p.documents.find(
        (d) => d.id !== superseded && d.marked_corrected === true && d.title.startsWith(docStem(p, superseded)),
      );
      if (replacement) edges.push({ version: v.version, fromRef: replacement.id, toRef: superseded, relation: "supersedes" });
    }
    for (const a of v.assets) {
      for (const src of a.sources) edges.push({ version: v.version, fromRef: src, toRef: `asset:${a.asset_id}`, relation: "supports" });
    }
  }
  const prior = p.prior_years.return_2024 as { line_sources?: Record<string, string> } | undefined;
  for (const [key, src] of Object.entries(prior?.line_sources ?? {})) {
    edges.push({ version: null, fromRef: src, toRef: `py:/return_2024/lines/${key}`, relation: "supports" });
  }
  return edges;
}

function docStem(p: Packet, id: string): string {
  const title = p.documents.find((d) => d.id === id)?.title ?? "";
  return title.split(" (")[0].replace(/ - CORRECTED.*$/, "");
}

export async function countPacket(db: Db, packetId: string): Promise<PacketCounts> {
  const count = async (table: typeof t.documents | typeof t.documentPages | typeof t.extractedValues | typeof t.referenceEdges) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.packetId, packetId));
    return row?.n ?? 0;
  };
  const lineRows = await db
    .select({ version: t.returnLines.version, n: sql<number>`count(*)::int` })
    .from(t.returnLines)
    .where(eq(t.returnLines.packetId, packetId))
    .groupBy(t.returnLines.version);
  const lines: Record<string, number> = {};
  for (const r of lineRows) lines[r.version] = r.n;
  return {
    documents: await count(t.documents),
    pages: await count(t.documentPages),
    extractedValues: await count(t.extractedValues),
    lines,
    edges: await count(t.referenceEdges),
  };
}
