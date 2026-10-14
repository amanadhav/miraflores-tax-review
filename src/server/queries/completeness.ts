/**
 * Read model for the completeness screen: where every document stands at the
 * replay clock (used by the engine, superseded, dispositioned by a person,
 * unaccounted, or not yet available), pages the pipeline read nothing from,
 * the area applicability checklist, outside filings and the batches the
 * viewer can still undo. Staff only; clients get a refusal.
 */
import { and, asc, eq, isNull, or } from "drizzle-orm";
import * as t from "@/db/schema";
import { AREAS, areaForDocument, areaLabel } from "@/domain/areas";
import { can } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import { isAvailable } from "@/packet/availability";
import { indexPacket } from "@/packet/load";
import { parseRef } from "@/packet/refs";
import type { SessionContext } from "../context";
import { activeVersion } from "../state";
import { typeLabel } from "./evidence";
import { actorOrUnknown, clockIso, isoOrNull, refusalFor, selfView, taskRow, type Refusal, type TaskRow } from "./people";
import type { ActorView } from "./review";

export type DocStatus = "used" | "superseded" | "dispositioned" | "unaccounted" | "not_yet_available";
export const DOC_STATUSES: DocStatus[] = ["used", "superseded", "dispositioned", "unaccounted", "not_yet_available"];

export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  used: "Used by the engine",
  superseded: "Superseded",
  dispositioned: "Dispositioned",
  unaccounted: "Unaccounted",
  not_yet_available: "Not yet available",
};

export type DispositionKind = "used" | "duplicate" | "superseded" | "not_applicable" | "outside_scope" | "manual_review" | "reviewed_no_use";

export const DISPOSITION_KIND_LABELS: Record<DispositionKind, string> = {
  used: "Used",
  duplicate: "Duplicate",
  superseded: "Superseded",
  not_applicable: "Not applicable",
  outside_scope: "Outside scope",
  manual_review: "Needs manual review",
  reviewed_no_use: "Reviewed, no use",
};

export interface DispositionView {
  id: string;
  disposition: DispositionKind;
  label: string;
  note: string | null;
  actor: ActorView;
  createdRevision: number;
  createdAt: string;
  batchId: string | null;
}

export interface CompletenessDoc {
  id: string;
  ref: string;
  title: string;
  typeLabel: string;
  issuer: string;
  receivedAt: string;
  available: boolean;
  area: string;
  areaLabel: string;
  status: DocStatus;
  statusLabel: string;
  /** Listed in documents_used of the active version. */
  usedByEngine: boolean;
  supersededBy: string | null;
  /** Latest disposition still in force, whatever the status. */
  disposition: DispositionView | null;
  extractionStatus: string;
  extractionReason: string | null;
  /** Pages of a partially extracted document with printed content but no extracted value. */
  pagesWithoutValues: number[];
  /** Pages that print only a "nothing further" statement; counted, not listed. */
  statedEmptyPages: number;
}

export interface PageRow {
  ref: string;
  documentId: string;
  title: string;
  page: number;
  available: boolean;
  href: string;
  disposition: DispositionView | null;
}

export interface AreaApplicability {
  id: string;
  ref: string;
  label: string;
  description: string;
  disposition: DispositionView | null;
  /** True when marked as applying, false when marked not applicable or outside scope, null when undecided. */
  applies: boolean | null;
}

export interface BatchView {
  batchId: string;
  disposition: DispositionKind;
  label: string;
  note: string | null;
  actor: ActorView;
  createdRevision: number;
  createdAt: string;
  subjects: string[];
  mine: boolean;
  canUndo: boolean;
}

export interface CompletenessFilters {
  status?: string;
  area?: string;
}

export interface CompletenessView {
  asOf: string;
  version: string;
  revision: number;
  actor: ActorView & { canDisposition: boolean; canUndoOthers: boolean; canCreateTask: boolean };
  documents: CompletenessDoc[];
  total: number;
  counts: Record<DocStatus, number>;
  filters: { status: DocStatus | null; area: string | null };
  areas: { id: string; label: string; count: number }[];
  applicability: AreaApplicability[];
  pages: PageRow[];
  outsideFilings: TaskRow[];
  batches: BatchView[];
  dispositions: { value: DispositionKind; label: string }[];
  owners: ActorView[];
  allAreas: { id: string; label: string }[];
}

type DispositionRowDb = typeof t.dispositions.$inferSelect;

const NOTHING_FURTHER = /no further transactions|intentionally (left )?blank|this page (is )?blank|nothing further/i;

/** A page whose printed content only says there is nothing more on it. */
export function statesNothingFurther(printed: string): boolean {
  return printed.trim().length < 200 && NOTHING_FURTHER.test(printed);
}

function dispositionView(ctx: SessionContext, d: DispositionRowDb): DispositionView {
  const kind = d.disposition as DispositionKind;
  return {
    id: d.id,
    disposition: kind,
    label: DISPOSITION_KIND_LABELS[kind] ?? d.disposition.replace(/_/g, " "),
    note: d.note,
    actor: actorOrUnknown(ctx.packet.packet, d.actorId),
    createdRevision: d.createdRevision,
    createdAt: isoOrNull(d.createdAt) ?? d.createdAt,
    batchId: d.batchId,
  };
}

export async function completenessView(ctx: SessionContext, filters: CompletenessFilters = {}): Promise<CompletenessView | Refusal> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const packet = ctx.packet.packet;
  const idx = indexPacket(packet);
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const wsId = ctx.workspace.id;
  const version = activeVersion(ctx);
  const [dispositions, tasks, supersessions] = await Promise.all([
    ctx.db
      .select()
      .from(t.dispositions)
      .where(and(eq(t.dispositions.workspaceId, wsId), isNull(t.dispositions.withdrawnRevision)))
      .orderBy(asc(t.dispositions.createdRevision), asc(t.dispositions.createdAt)),
    ctx.db.select().from(t.tasks).where(and(eq(t.tasks.workspaceId, wsId), eq(t.tasks.kind, "outside_filing"))).orderBy(asc(t.tasks.createdRevision)),
    ctx.db
      .select({ fromRef: t.referenceEdges.fromRef, toRef: t.referenceEdges.toRef })
      .from(t.referenceEdges)
      .where(
        and(
          eq(t.referenceEdges.packetId, ctx.workspace.packetId),
          eq(t.referenceEdges.relation, "supersedes"),
          eq(t.referenceEdges.version, version.version),
          or(isNull(t.referenceEdges.workspaceId), eq(t.referenceEdges.workspaceId, wsId)),
        ),
      ),
  ]);
  // Latest disposition in force per subject (rows are in creation order).
  const latest = new Map<string, DispositionRowDb>();
  for (const d of dispositions) latest.set(d.subjectRef, d);
  const used = new Set(version.documents_used);
  const superseded = new Set(version.documents_superseded);
  const supersededByMap = new Map<string, string>();
  for (const e of supersessions) supersededByMap.set(e.toRef, e.fromRef);

  const documents: CompletenessDoc[] = packet.documents.map((d) => {
    const available = isAvailable(packet, d.id, asOf);
    const disposition = latest.get(d.id);
    const supersededBy = supersededByMap.get(d.id) ?? null;
    const status: DocStatus = !available ? "not_yet_available" : used.has(d.id) ? "used" : superseded.has(d.id) || supersededBy ? "superseded" : disposition ? "dispositioned" : "unaccounted";
    const area = areaForDocument(d.document_type, d.issuer);
    const valueCount = (page: number) => (idx.valuesByPage.get(`${d.id}#${page}`) ?? []).length;
    const emptyPages = d.extraction.status === "partial" ? d.pages.filter((p) => valueCount(p.page) === 0) : [];
    return {
      id: d.id,
      ref: d.id,
      title: d.title,
      typeLabel: typeLabel(d.document_type),
      issuer: d.issuer,
      receivedAt: d.received_at,
      available,
      area,
      areaLabel: areaLabel(area),
      status,
      statusLabel: DOC_STATUS_LABELS[status],
      usedByEngine: used.has(d.id),
      supersededBy,
      disposition: disposition ? dispositionView(ctx, disposition) : null,
      extractionStatus: d.extraction.status,
      extractionReason: d.extraction.reason,
      pagesWithoutValues: emptyPages.filter((p) => !statesNothingFurther(p.printed_content)).map((p) => p.page),
      statedEmptyPages: emptyPages.filter((p) => statesNothingFurther(p.printed_content)).length,
    };
  });
  const counts: Record<DocStatus, number> = { used: 0, superseded: 0, dispositioned: 0, unaccounted: 0, not_yet_available: 0 };
  for (const d of documents) counts[d.status] += 1;
  const status = DOC_STATUSES.includes(filters.status as DocStatus) ? (filters.status as DocStatus) : null;
  const area = AREAS.some((a) => a.id === filters.area) ? filters.area! : null;
  const filtered = documents.filter((d) => (!status || d.status === status) && (!area || d.area === area));

  const pages: PageRow[] = documents
    .filter((d) => d.pagesWithoutValues.length > 0 && (!area || d.area === area))
    .flatMap((d) =>
      d.pagesWithoutValues.map((page) => {
        const ref = `doc:${d.id}#page${page}`;
        const disp = latest.get(ref);
        return { ref, documentId: d.id, title: d.title, page, available: d.available, href: `/evidence/${d.id}?page=${page}`, disposition: disp ? dispositionView(ctx, disp) : null };
      }),
    );

  const applicability: AreaApplicability[] = AREAS.map((a) => {
    const ref = `area:${a.id}`;
    const disp = latest.get(ref);
    const view = disp ? dispositionView(ctx, disp) : null;
    const applies = !view ? null : view.disposition === "not_applicable" || view.disposition === "outside_scope" ? false : true;
    return { id: a.id, ref, label: a.label, description: a.description, disposition: view, applies };
  });

  const batchMap = new Map<string, DispositionRowDb[]>();
  for (const d of dispositions) {
    if (!d.batchId) continue;
    (batchMap.get(d.batchId) ?? batchMap.set(d.batchId, []).get(d.batchId)!).push(d);
  }
  const canUndoOthers = can(ctx.actor, "undo_adjustment");
  const batches: BatchView[] = [...batchMap.entries()]
    .map(([batchId, rows]) => {
      const first = rows[0];
      const mine = first.actorId === ctx.actor.id;
      return {
        batchId,
        disposition: first.disposition as DispositionKind,
        label: DISPOSITION_KIND_LABELS[first.disposition as DispositionKind] ?? first.disposition,
        note: first.note,
        actor: actorOrUnknown(packet, first.actorId),
        createdRevision: first.createdRevision,
        createdAt: isoOrNull(first.createdAt) ?? first.createdAt,
        subjects: rows.map((r) => r.subjectRef),
        mine,
        canUndo: mine || canUndoOthers,
      };
    })
    .sort((a, b) => b.createdRevision - a.createdRevision);

  const view: CompletenessView = {
    asOf,
    version: version.version,
    revision: ctx.workspace.revision,
    actor: { ...selfView(ctx), canDisposition: can(ctx.actor, "add_verification"), canUndoOthers, canCreateTask: can(ctx.actor, "raise_finding") },
    documents: filtered,
    total: documents.length,
    counts,
    filters: { status, area },
    areas: AREAS.map((a) => ({ id: a.id, label: a.label, count: documents.filter((d) => d.area === a.id).length })).filter((a) => a.count > 0),
    applicability,
    pages,
    outsideFilings: tasks.map((x) => taskRow(ctx, asOf, x)),
    batches,
    dispositions: (Object.keys(DISPOSITION_KIND_LABELS) as DispositionKind[]).map((value) => ({ value, label: DISPOSITION_KIND_LABELS[value] })),
    owners: packet.firm.staff.map((s) => ({ id: s.id, name: s.name, role: s.role.replace(/_/g, " ") })),
    allAreas: AREAS.map((a) => ({ id: a.id, label: a.label })),
  };
  return redact.deep(view);
}

/** Subject references a batch disposition accepts: documents, pages and areas. */
export function isDispositionSubject(ref: string): boolean {
  if (ref.startsWith("area:")) return true;
  const k = parseRef(ref).kind;
  return k === "document" || k === "document_page";
}
