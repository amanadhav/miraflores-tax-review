/**
 * Read models for the Changes section: what changed since this person last
 * looked (per-user revision cursor, never a browser timestamp), the change
 * ledger with estimated effects, the full audit timeline, engine version
 * comparison, the supplied what-if alternatives and the replay timeline.
 *
 * Every packet-derived string and every piece of audit metadata is redacted
 * here, before it reaches a page, so no screen has to remember to do it.
 */
import { and, asc, count, desc, eq, gt, type SQL } from "drizzle-orm";
import * as t from "@/db/schema";
import { AREAS, areaLabel } from "@/domain/areas";
import { CATEGORY_LABELS, round2, type EffectCategory } from "@/domain/effects";
import { findActor } from "@/domain/policy";
import { makeRedactor, type Redactor } from "@/domain/redaction";
import { indexPacket } from "@/packet/load";
import { resolveRef } from "@/packet/refs";
import type { Diagnostic, LineChange, Packet, ReturnVersion, WhatIfAlternative } from "@/packet/types";
import type { AuditRow } from "@/server/commands";
import type { SessionContext } from "@/server/context";
import type { AdjustmentRow } from "@/server/state";

export const PAGE_SIZE = 50;

/* ------------------------------------------------------------------------ */
/* Shared pieces                                                              */
/* ------------------------------------------------------------------------ */

const ACTION_LABELS: Record<string, string> = {
  workspace_created: "created the workspace",
  adjustment_proposed: "proposed a change",
  adjustment_accepted: "accepted a change",
  adjustment_rejected: "rejected a change",
  adjustment_superseded: "superseded an earlier change",
  adjustment_undone: "undid a change",
  verification_recorded: "recorded a verification",
  anchor_added: "anchored evidence to a page",
  finding_raised: "raised a finding",
  finding_resolved: "resolved a finding",
  finding_dismissed: "dismissed a finding",
  signoff_recorded: "signed off",
  signoff_withdrawn: "withdrew a sign-off",
  signoff_reopened: "had a sign-off reopened",
  clock_moved: "moved the replay clock",
  version_selected: "selected an engine version as the baseline",
  session_persona_switched: "switched persona in a browser session",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ");
}

export function actorName(packet: Packet, actorId: string): string {
  if (actorId === "system") return "System";
  if (actorId === "engine") return "Engine";
  return findActor(packet, actorId)?.name ?? actorId;
}

export interface AuditEventView {
  id: number;
  revision: number;
  actorId: string;
  actorName: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId: string;
  /** Workpaper reference for the entity when the app has a home for it. */
  entityRef: string | null;
  summary: string;
  area: string | null;
  areaLabel: string | null;
  businessTime: string;
  createdAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

function eventView(packet: Packet, redact: Redactor, row: AuditRow): AuditEventView {
  const entityRef = row.entityType === "adjustment" || row.entityType === "finding" ? `${row.entityType}:${row.entityId}` : null;
  return {
    id: row.id,
    revision: row.revision,
    actorId: row.actorId,
    actorName: actorName(packet, row.actorId),
    action: row.action,
    actionLabel: actionLabel(row.action),
    entityType: row.entityType,
    entityId: row.entityId,
    entityRef,
    summary: redact.text(row.summary),
    area: row.area,
    areaLabel: row.area ? areaLabel(row.area) : null,
    businessTime: new Date(row.businessTime).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(),
    before: asRecord(redact.deep(row.before)),
    after: asRecord(redact.deep(row.after)),
  };
}

export interface RefView {
  ref: string;
  label: string;
  found: boolean;
}

function refView(packet: Packet, redact: Redactor, ref: string, version: string): RefView {
  const r = resolveRef(packet, ref, { version });
  return { ref, label: redact.text(r.label), found: r.found };
}

function lineLabel(packet: Packet, version: string, key: string): string {
  const line = indexPacket(packet).linesByVersion.get(version)?.get(key);
  return line ? `${line.form} line ${line.line}: ${line.label}` : key;
}

function versionOrThrow(packet: Packet, id: string): ReturnVersion {
  const v = indexPacket(packet).versions.get(id);
  if (!v) throw new Error(`${id} is not a return version in the packet`);
  return v;
}

export function versionIds(ctx: SessionContext): string[] {
  return ctx.packet.packet.return_versions.map((v) => v.version);
}

function paginate<T>(rows: T[], page: number, pageSize = PAGE_SIZE): { rows: T[]; page: number; pageCount: number; total: number; pageSize: number } {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, Math.floor(page || 1)), pageCount);
  return { rows: rows.slice((p - 1) * pageSize, p * pageSize), page: p, pageCount, total, pageSize };
}

/* ------------------------------------------------------------------------ */
/* 1a. Since you last looked                                                  */
/* ------------------------------------------------------------------------ */

export interface SinceLastLooked {
  /** Revision this person marked as seen; null when they never have. */
  cursor: number | null;
  currentRevision: number;
  groups: { revision: number; events: AuditEventView[] }[];
  eventCount: number;
}

export async function sinceLastLooked(ctx: SessionContext): Promise<SinceLastLooked> {
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const [cursorRow] = await ctx.db
    .select()
    .from(t.seenCursors)
    .where(and(eq(t.seenCursors.workspaceId, ctx.workspace.id), eq(t.seenCursors.actorId, ctx.actor.id)));
  const cursor = cursorRow?.revision ?? null;
  const where: SQL =
    cursor === null
      ? eq(t.auditEvents.workspaceId, ctx.workspace.id)
      : and(eq(t.auditEvents.workspaceId, ctx.workspace.id), gt(t.auditEvents.revision, cursor))!;
  const rows = await ctx.db.select().from(t.auditEvents).where(where).orderBy(asc(t.auditEvents.revision), asc(t.auditEvents.id));
  const groups: SinceLastLooked["groups"] = [];
  for (const row of rows) {
    const view = eventView(packet, redact, row);
    const last = groups[groups.length - 1];
    if (last && last.revision === row.revision) last.events.push(view);
    else groups.push({ revision: row.revision, events: [view] });
  }
  return { cursor, currentRevision: ctx.workspace.revision, groups, eventCount: rows.length };
}

/* ------------------------------------------------------------------------ */
/* 1b. Change ledger                                                          */
/* ------------------------------------------------------------------------ */

export interface LedgerRow {
  id: string;
  targetRef: string;
  targetLabel: string;
  area: string;
  areaLabel: string;
  kind: string;
  baselineVersion: string;
  needsRebase: boolean;
  priorValue: unknown;
  proposedValue: unknown;
  priorLabel: string | null;
  proposedLabel: string | null;
  reason: string;
  evidence: RefView[];
  category: string | null;
  categoryLabel: string | null;
  measureDelta: number | null;
  caSource: boolean;
  effectFederal: number | null;
  effectCalifornia: number | null;
  balanceFederal: number | null;
  balanceCalifornia: number | null;
  effectStatus: string;
  effectBasis: string | null;
  limitations: string[];
  requiresPartner: boolean;
  status: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  createdRevision: number;
  decidedBy: string | null;
  deciderName: string | null;
  decidedAt: string | null;
  decidedRevision: number | null;
  decisionNote: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  revertsId: string | null;
  revertedById: string | null;
}

export interface Ledger {
  activeVersion: string;
  rows: LedgerRow[];
  counts: Record<string, number>;
  needsRebaseCount: number;
  /** Sum over rows whose status is exactly "accepted"; superseded and reverted rows are out by status. */
  net: {
    accepted: number;
    federal: number;
    california: number;
    balanceFederal: number;
    balanceCalifornia: number;
    unknownCount: number;
    limitations: string[];
    ratesVersion: string;
  };
}

function num(value: string | null): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ledgerRow(ctx: SessionContext, redact: Redactor, all: AdjustmentRow[], a: AdjustmentRow): LedgerRow {
  const packet = ctx.packet.packet;
  const supersededBy = all.find((o) => o.supersedesId === a.id);
  const revertedBy = all.find((o) => o.revertsId === a.id);
  return {
    id: a.id,
    targetRef: a.targetRef,
    targetLabel: redact.text(lineLabel(packet, a.baselineVersion, a.targetRef)),
    area: a.area,
    areaLabel: areaLabel(a.area),
    kind: a.kind,
    baselineVersion: a.baselineVersion,
    needsRebase: a.baselineVersion !== ctx.workspace.activeVersion,
    priorValue: redact.deep(a.priorValue),
    proposedValue: redact.deep(a.proposedValue),
    priorLabel: a.priorLabel === null ? null : redact.text(a.priorLabel),
    proposedLabel: a.proposedLabel === null ? null : redact.text(a.proposedLabel),
    reason: redact.text(a.reason),
    evidence: a.evidenceRefs.map((r) => refView(packet, redact, r, a.baselineVersion)),
    category: a.category,
    categoryLabel: a.category ? (CATEGORY_LABELS[a.category as EffectCategory] ?? a.category) : null,
    measureDelta: num(a.measureDelta),
    caSource: a.caSource,
    effectFederal: num(a.effectFederal),
    effectCalifornia: num(a.effectCalifornia),
    balanceFederal: num(a.balanceFederal),
    balanceCalifornia: num(a.balanceCalifornia),
    effectStatus: a.effectStatus,
    effectBasis: a.effectBasis === null ? null : redact.text(a.effectBasis),
    limitations: a.limitations.map((l) => redact.text(l)),
    requiresPartner: a.requiresPartner,
    status: a.status,
    authorId: a.authorId,
    authorName: actorName(packet, a.authorId),
    createdAt: new Date(a.createdAt).toISOString(),
    createdRevision: a.createdRevision,
    decidedBy: a.decidedBy,
    deciderName: a.decidedBy ? actorName(packet, a.decidedBy) : null,
    decidedAt: a.decidedAt ? new Date(a.decidedAt).toISOString() : null,
    decidedRevision: a.decidedRevision,
    decisionNote: a.decisionNote === null ? null : redact.text(a.decisionNote),
    supersedesId: a.supersedesId,
    supersededById: supersededBy?.id ?? null,
    revertsId: a.revertsId,
    revertedById: revertedBy?.id ?? null,
  };
}

export async function ledger(ctx: SessionContext): Promise<Ledger> {
  const redact = makeRedactor(ctx.packet.packet);
  const all = await ctx.db
    .select()
    .from(t.adjustments)
    .where(eq(t.adjustments.workspaceId, ctx.workspace.id))
    .orderBy(asc(t.adjustments.createdRevision), asc(t.adjustments.createdAt));
  const rows = all.map((a) => ledgerRow(ctx, redact, all, a));
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const accepted = rows.filter((r) => r.status === "accepted");
  const limitations = new Set<string>();
  let federal = 0;
  let california = 0;
  let balanceFederal = 0;
  let balanceCalifornia = 0;
  let unknownCount = 0;
  for (const r of accepted) {
    if (r.effectStatus === "unknown") unknownCount += 1;
    federal += r.effectFederal ?? 0;
    california += r.effectCalifornia ?? 0;
    balanceFederal += r.balanceFederal ?? 0;
    balanceCalifornia += r.balanceCalifornia ?? 0;
    for (const l of r.limitations) limitations.add(l);
  }
  return {
    activeVersion: ctx.workspace.activeVersion,
    rows,
    counts,
    needsRebaseCount: rows.filter((r) => r.needsRebase && (r.status === "proposed" || r.status === "accepted")).length,
    net: {
      accepted: accepted.length,
      federal: round2(federal),
      california: round2(california),
      balanceFederal: round2(balanceFederal),
      balanceCalifornia: round2(balanceCalifornia),
      unknownCount,
      limitations: [...limitations],
      ratesVersion: ctx.workspace.activeVersion,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* 1c. Full audit timeline                                                    */
/* ------------------------------------------------------------------------ */

export interface AuditFilters {
  actor?: string;
  area?: string;
  action?: string;
}

export interface AuditPage {
  events: AuditEventView[];
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  filters: AuditFilters;
  options: {
    actors: { id: string; name: string }[];
    areas: { id: string; label: string }[];
    actions: { id: string; label: string }[];
  };
}

export async function auditPage(ctx: SessionContext, filters: AuditFilters = {}, page = 1): Promise<AuditPage> {
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const clean: AuditFilters = {
    actor: filters.actor?.trim() || undefined,
    area: filters.area?.trim() || undefined,
    action: filters.action?.trim() || undefined,
  };
  const conditions: SQL[] = [eq(t.auditEvents.workspaceId, ctx.workspace.id)];
  if (clean.actor) conditions.push(eq(t.auditEvents.actorId, clean.actor));
  if (clean.area) conditions.push(eq(t.auditEvents.area, clean.area));
  if (clean.action) conditions.push(eq(t.auditEvents.action, clean.action));
  const where = and(...conditions)!;
  const [[totalRow], actorRows, actionRows] = await Promise.all([
    ctx.db.select({ n: count() }).from(t.auditEvents).where(where),
    ctx.db.selectDistinct({ actorId: t.auditEvents.actorId }).from(t.auditEvents).where(eq(t.auditEvents.workspaceId, ctx.workspace.id)),
    ctx.db.selectDistinct({ action: t.auditEvents.action }).from(t.auditEvents).where(eq(t.auditEvents.workspaceId, ctx.workspace.id)),
  ]);
  const total = Number(totalRow?.n ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(page || 1)), pageCount);
  const rows = await ctx.db
    .select()
    .from(t.auditEvents)
    .where(where)
    .orderBy(desc(t.auditEvents.revision), desc(t.auditEvents.id))
    .limit(PAGE_SIZE)
    .offset((p - 1) * PAGE_SIZE);
  return {
    events: rows.map((r) => eventView(packet, redact, r)),
    page: p,
    pageSize: PAGE_SIZE,
    pageCount,
    total,
    filters: clean,
    options: {
      actors: actorRows.map((r) => ({ id: r.actorId, name: actorName(packet, r.actorId) })).sort((a, b) => a.name.localeCompare(b.name)),
      areas: AREAS.map((a) => ({ id: a.id, label: a.label })),
      actions: actionRows.map((r) => ({ id: r.action, label: actionLabel(r.action) })).sort((a, b) => a.label.localeCompare(b.label)),
    },
  };
}

/* ------------------------------------------------------------------------ */
/* 2. Version comparison                                                      */
/* ------------------------------------------------------------------------ */

export interface VersionSummaryRow {
  version: string;
  computedAt: string;
  trigger: string;
  documentsUsed: number;
  documentsSuperseded: number;
  lines: number;
  federal: Record<string, number>;
  california: Record<string, number>;
  diagnosticsCount: number;
  isActive: boolean;
  isSelected: boolean;
}

export interface DiagnosticView {
  code: string;
  severity: Diagnostic["severity"];
  message: string;
  refs: RefView[];
}

export interface LineChangeView {
  key: string;
  label: string;
  change: LineChange["change"];
  old: unknown;
  new: unknown;
}

export interface VersionCompare {
  activeVersion: string;
  asOf: string;
  versions: VersionSummaryRow[];
  selected: {
    version: string;
    computedAt: string;
    trigger: string;
    previousVersion: string | null;
    changesFromPrevious: LineChangeView[];
    diagnostics: DiagnosticView[];
    /** Diagnostics present in the previous version and absent here. */
    resolvedDiagnostics: DiagnosticView[];
    /** Diagnostics absent in the previous version and present here. */
    newDiagnostics: DiagnosticView[];
  };
  diff: {
    from: string;
    to: string;
    added: number;
    removed: number;
    changed: number;
    rows: LineChangeView[];
    page: number;
    pageCount: number;
    total: number;
    pageSize: number;
  };
}

function diagnosticView(packet: Packet, redact: Redactor, d: Diagnostic, version: string): DiagnosticView {
  return { code: d.code, severity: d.severity, message: redact.text(d.message), refs: d.refs.map((r) => refView(packet, redact, r, version)) };
}

/** Line-by-line difference between two engine versions, computed from the packet lines (value only). */
export function lineDiff(packet: Packet, from: string, to: string): LineChangeView[] {
  const idx = indexPacket(packet);
  const a = idx.linesByVersion.get(from);
  const b = idx.linesByVersion.get(to);
  if (!a || !b) return [];
  const redact = makeRedactor(packet);
  const out: LineChangeView[] = [];
  for (const [key, line] of b) {
    const prior = a.get(key);
    if (!prior) out.push({ key, label: redact.text(lineLabel(packet, to, key)), change: "added", old: undefined, new: redact.deep(line.value) });
    else if (JSON.stringify(prior.value) !== JSON.stringify(line.value)) {
      out.push({ key, label: redact.text(lineLabel(packet, to, key)), change: "changed", old: redact.deep(prior.value), new: redact.deep(line.value) });
    }
  }
  for (const [key, line] of a) {
    if (!b.has(key)) out.push({ key, label: redact.text(lineLabel(packet, from, key)), change: "removed", old: redact.deep(line.value), new: undefined });
  }
  return out;
}

export async function versionCompare(
  ctx: SessionContext,
  from: string,
  to: string,
  opts: { selected?: string; page?: number } = {},
): Promise<VersionCompare> {
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const all = packet.return_versions;
  versionOrThrow(packet, from);
  versionOrThrow(packet, to);
  const selectedId = opts.selected ?? to;
  const selected = versionOrThrow(packet, selectedId);
  const position = all.findIndex((v) => v.version === selectedId);
  const previous = position > 0 ? all[position - 1] : null;
  const prevCodes = new Set((previous?.diagnostics ?? []).map((d) => d.code));
  const curCodes = new Set(selected.diagnostics.map((d) => d.code));
  const versions: VersionSummaryRow[] = all.map((v) => ({
    version: v.version,
    computedAt: v.computed_at,
    trigger: redact.text(v.trigger),
    documentsUsed: v.documents_used.length,
    documentsSuperseded: v.documents_superseded.length,
    lines: v.lines.length,
    federal: v.summary.federal,
    california: v.summary.california,
    diagnosticsCount: v.diagnostics.length,
    isActive: v.version === ctx.workspace.activeVersion,
    isSelected: v.version === selectedId,
  }));
  const diffRows = lineDiff(packet, from, to);
  const paged = paginate(diffRows, opts.page ?? 1);
  return {
    activeVersion: ctx.workspace.activeVersion,
    asOf: new Date(ctx.workspace.asOf).toISOString(),
    versions,
    selected: {
      version: selected.version,
      computedAt: selected.computed_at,
      trigger: redact.text(selected.trigger),
      previousVersion: previous?.version ?? null,
      changesFromPrevious: selected.changes_from_previous.map((c) => ({
        key: c.key,
        label: redact.text(lineLabel(packet, c.change === "removed" && previous ? previous.version : selected.version, c.key)),
        change: c.change,
        old: redact.deep(c.old),
        new: redact.deep(c.new),
      })),
      diagnostics: selected.diagnostics.map((d) => diagnosticView(packet, redact, d, selected.version)),
      resolvedDiagnostics: (previous?.diagnostics ?? []).filter((d) => !curCodes.has(d.code)).map((d) => diagnosticView(packet, redact, d, previous!.version)),
      newDiagnostics: selected.diagnostics.filter((d) => !prevCodes.has(d.code)).map((d) => diagnosticView(packet, redact, d, selected.version)),
    },
    diff: {
      from,
      to,
      added: diffRows.filter((r) => r.change === "added").length,
      removed: diffRows.filter((r) => r.change === "removed").length,
      changed: diffRows.filter((r) => r.change === "changed").length,
      ...paged,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* 3. What-if alternatives                                                    */
/* ------------------------------------------------------------------------ */

export interface WhatIfSummary {
  id: string;
  description: string;
  baseVersion: string;
  choices: Record<string, string>;
  /** Other alternatives that set the same choice; only one of them can ever apply. */
  exclusiveWith: string[];
  federalTaxChange: number;
  federalPenaltyChange: number;
  californiaTaxChange: number;
  changedLinesCount: number;
  isSelected: boolean;
}

export interface WhatIfSelected extends WhatIfSummary {
  federal: { base: Record<string, number>; alternative: Record<string, number> };
  california: { base: Record<string, number>; alternative: Record<string, number> };
  suppliedLabel: string;
  changedLines: { rows: LineChangeView[]; page: number; pageCount: number; total: number; pageSize: number };
}

export interface WhatIfView {
  activeVersion: string;
  acceptedCount: number;
  alternatives: WhatIfSummary[];
  selected: WhatIfSelected | null;
  /** Whether the supplied alternative figures can stand as the workpaper's combined result. */
  combined: { available: boolean; reason: string | null };
  extension: {
    computedAt: string;
    basedOnVersion: string;
    federal: Record<string, unknown>;
    california: Record<string, unknown>;
  };
}

function whatIfSummary(redact: Redactor, all: WhatIfAlternative[], a: WhatIfAlternative, selectedId: string | null): WhatIfSummary {
  const keys = Object.keys(a.choices);
  const exclusiveWith = all.filter((o) => o.id !== a.id && Object.keys(o.choices).some((k) => keys.includes(k))).map((o) => o.id);
  return {
    id: a.id,
    description: redact.text(a.description),
    baseVersion: a.base_version,
    choices: a.choices,
    exclusiveWith,
    federalTaxChange: a.federal.total_tax_change,
    federalPenaltyChange: a.federal.penalty_change,
    californiaTaxChange: a.california.total_tax_change,
    changedLinesCount: a.changed_lines.length,
    isSelected: a.id === selectedId,
  };
}

export async function whatIfView(ctx: SessionContext, altId: string | null, page = 1): Promise<WhatIfView> {
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const all = packet.what_if.alternatives;
  const alt = altId ? all.find((a) => a.id === altId) ?? null : null;
  const selectedId = alt?.id ?? null;
  const [acceptedRow] = await ctx.db
    .select({ n: count() })
    .from(t.adjustments)
    .where(and(eq(t.adjustments.workspaceId, ctx.workspace.id), eq(t.adjustments.status, "accepted")));
  const acceptedCount = Number(acceptedRow?.n ?? 0);
  const activeVersion = ctx.workspace.activeVersion;
  let combined: WhatIfView["combined"] = { available: false, reason: "Select one alternative to see its supplied result." };
  if (alt) {
    if (acceptedCount > 0) {
      combined = {
        available: false,
        reason: `A combined result is not available: the supplied result applies to pristine ${alt.base_version} only; the workpaper has ${acceptedCount} accepted ${acceptedCount === 1 ? "change" : "changes"}.`,
      };
    } else if (activeVersion !== alt.base_version) {
      combined = {
        available: false,
        reason: `A combined result is not available: the supplied result applies to pristine ${alt.base_version} only; the workpaper baseline is ${activeVersion}.`,
      };
    } else {
      combined = { available: true, reason: null };
    }
  }
  const ext = redact.deep(packet.what_if.extension) as Record<string, unknown>;
  return {
    activeVersion,
    acceptedCount,
    alternatives: all.map((a) => whatIfSummary(redact, all, a, selectedId)),
    selected: alt
      ? {
          ...whatIfSummary(redact, all, alt, selectedId),
          federal: { base: alt.federal.base, alternative: alt.federal.alternative },
          california: { base: alt.california.base, alternative: alt.california.alternative },
          suppliedLabel: `exact as supplied for pristine ${alt.base_version}`,
          changedLines: paginate(
            alt.changed_lines.map((c) => ({
              key: c.key,
              label: redact.text(lineLabel(packet, alt.base_version, c.key)),
              change: c.change,
              old: redact.deep(c.old),
              new: redact.deep(c.new),
            })),
            page,
          ),
        }
      : null,
    combined,
    extension: {
      computedAt: String(ext.computed_at ?? ""),
      basedOnVersion: String(ext.based_on_version ?? ""),
      federal: (ext.federal as Record<string, unknown>) ?? {},
      california: (ext.california as Record<string, unknown>) ?? {},
    },
  };
}

/* ------------------------------------------------------------------------ */
/* 4. Replay timeline                                                         */
/* ------------------------------------------------------------------------ */

export interface TimelineEventView {
  id: string;
  at: string;
  event: string;
  eventLabel: string;
  actorId: string | null;
  actorName: string | null;
  /** True when the event is at or before the replay clock. */
  isPast: boolean;
  /** Past events only; future events never expose detail text or amounts. */
  detail: string | null;
  /** Past events only. */
  refs: RefView[];
  isExtension: boolean;
}

export interface TimelineView {
  asOf: string;
  activeVersion: string;
  events: TimelineEventView[];
  pastCount: number;
  futureCount: number;
  /** The latest past event: where the clock sits on the timeline. */
  clockAtEventId: string | null;
  /** The first future event, which "advance" naturally moves to next. */
  nextEventId: string | null;
}

export const EXTENSION_EVENT_ID = "extension-2026-04-14";

export async function timelineView(ctx: SessionContext): Promise<TimelineView> {
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const asOf = new Date(ctx.workspace.asOf).toISOString();
  const clock = new Date(asOf).getTime();
  const version = ctx.workspace.activeVersion;
  const ordered = [...packet.timeline].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const events: TimelineEventView[] = ordered.map((e) => {
    const isPast = new Date(e.at).getTime() <= clock;
    return {
      id: e.id,
      at: e.at,
      event: e.event,
      eventLabel: e.event.replace(/_/g, " "),
      actorId: e.actor,
      actorName: e.actor ? actorName(packet, e.actor) : null,
      isPast,
      detail: isPast && e.detail ? redact.text(e.detail) : null,
      refs: isPast ? e.refs.map((r) => refView(packet, redact, r, version)) : [],
      isExtension: e.id === EXTENSION_EVENT_ID,
    };
  });
  const past = events.filter((e) => e.isPast);
  const future = events.filter((e) => !e.isPast);
  return {
    asOf,
    activeVersion: version,
    events,
    pastCount: past.length,
    futureCount: future.length,
    clockAtEventId: past.length ? past[past.length - 1].id : null,
    nextEventId: future.length ? future[0].id : null,
  };
}
