/**
 * Read models for the People section: requests and their threads, tasks,
 * the inbox and time against budget. These are staff screens: a client actor
 * receives a short refusal model instead of data. Every packet-derived string
 * passes through the redactor before it leaves the server.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import * as t from "@/db/schema";
import { AREAS, areaLabel } from "@/domain/areas";
import { can, findActor, isAvailableAt } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import { availableAt } from "@/packet/availability";
import { resolveRef } from "@/packet/refs";
import type { Packet } from "@/packet/types";
import type { SessionContext } from "../context";
import { loadWorkspaceState, type WorkspaceState } from "../state";
import type { ActorView, RefView } from "./review";

/* ------------------------------------------------------------------------ */
/* Shared pieces (also used by the judgments and completeness queries).      */
/* ------------------------------------------------------------------------ */

/** What a client actor gets from a staff query: a reason, never data. */
export interface Refusal {
  refused: true;
  message: string;
}

export function refusalFor(ctx: SessionContext): Refusal | null {
  if (ctx.actor.role !== "client") return null;
  return { refused: true, message: "This screen is for firm staff. Your requests and approvals are on the client page." };
}

export function isRefusal<T>(value: T | Refusal): value is Refusal {
  return typeof value === "object" && value !== null && "refused" in value && (value as Refusal).refused === true;
}

export function clockIso(ctx: SessionContext): string {
  return new Date(ctx.workspace.asOf).toISOString();
}

export function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

export function actorView(packet: Packet, id: string | null | undefined): ActorView | null {
  if (!id) return null;
  const a = findActor(packet, id);
  if (a) return { id: a.id, name: a.name, role: a.role.replace(/_/g, " ") };
  if (id === "engine") return { id, name: "Engine", role: "pipeline diagnostic" };
  if (id === "system") return { id, name: "System", role: "system" };
  return { id, name: id, role: "unknown" };
}

export function actorOrUnknown(packet: Packet, id: string): ActorView {
  return actorView(packet, id) ?? { id, name: id, role: "unknown" };
}

/** A reference resolved against the packet and judged at the replay clock. */
export function refView(packet: Packet, version: string, asOf: string, ref: string): RefView {
  const r = resolveRef(packet, ref, { version });
  const at = availableAt(packet, ref);
  const atIso = at ? isoOrNull(at) : null;
  const available = atIso ? new Date(atIso).getTime() <= new Date(asOf).getTime() : true;
  return { ref, label: r.label, kind: r.parsed.kind, found: r.found, availableAt: atIso, available };
}

export function selfView(ctx: SessionContext): ActorView {
  return { id: ctx.actor.id, name: ctx.actor.name, role: ctx.actor.role.replace(/_/g, " ") };
}

function isPast(iso: string | null, asOf: string): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() < new Date(asOf).getTime();
}

export const REQUEST_KIND_LABELS: Record<string, string> = {
  client_question: "Client question",
  colleague_question: "Colleague question",
  document_request: "Document request",
};

export const TASK_KIND_LABELS: Record<string, string> = {
  review: "Review",
  outside_filing: "Outside filing",
  follow_up: "Follow-up",
  planning: "Planning",
};

export const NOTIFICATION_KIND_LABELS: Record<string, string> = {
  request: "Question for you",
  reply: "Reply",
  assignment: "Task assigned",
  task_update: "Task update",
};

export function kindLabel(map: Record<string, string>, kind: string): string {
  return map[kind] ?? kind.replace(/_/g, " ");
}

/* ------------------------------------------------------------------------ */
/* Requests                                                                   */
/* ------------------------------------------------------------------------ */

export type RequestStatus = "open" | "answered" | "resolved" | "withdrawn";
export const REQUEST_STATUSES: RequestStatus[] = ["open", "answered", "resolved", "withdrawn"];

export interface RequestRow {
  id: string;
  ref: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string;
  from: ActorView;
  to: ActorView;
  dueAt: string | null;
  /** Due date passed at the replay clock and the request is still open or answered. */
  overdue: boolean;
  status: RequestStatus;
  refs: RefView[];
  area: string;
  areaLabel: string;
  businessTime: string;
  createdRevision: number;
  replyCount: number;
  lastReplyAt: string | null;
  resolution: string | null;
  resolvedBy: ActorView | null;
  resolvedRevision: number | null;
}

export interface RequestsFilters {
  status?: string;
  kind?: string;
}

export interface RequestsView {
  asOf: string;
  revision: number;
  actor: ActorView & { canCreate: boolean };
  requests: RequestRow[];
  counts: Record<RequestStatus, number>;
  total: number;
  overdue: number;
  filters: { status: RequestStatus | null; kind: string | null };
  recipients: { clients: ActorView[]; staff: (ActorView & { available: boolean })[] };
  areas: { id: string; label: string }[];
  kinds: { value: string; label: string }[];
}

type RequestRowDb = typeof t.requests.$inferSelect;
type ReplyRowDb = typeof t.requestReplies.$inferSelect;

function requestRow(ctx: SessionContext, asOf: string, r: RequestRowDb, replies: ReplyRowDb[]): RequestRow {
  const packet = ctx.packet.packet;
  const version = ctx.workspace.activeVersion;
  const mine = replies.filter((x) => x.requestId === r.id);
  const last = mine.reduce<string | null>((acc, x) => {
    const at = isoOrNull(x.businessTime);
    return !acc || (at && at > acc) ? at : acc;
  }, null);
  const dueAt = isoOrNull(r.dueAt);
  const status = r.status as RequestStatus;
  return {
    id: r.id,
    ref: `request:${r.id}`,
    kind: r.kind,
    kindLabel: kindLabel(REQUEST_KIND_LABELS, r.kind),
    title: r.title,
    body: r.body,
    from: actorOrUnknown(packet, r.fromActorId),
    to: actorOrUnknown(packet, r.toActorId),
    dueAt,
    overdue: (status === "open" || status === "answered") && isPast(dueAt, asOf),
    status,
    refs: r.refs.map((ref) => refView(packet, version, asOf, ref)),
    area: r.area,
    areaLabel: areaLabel(r.area),
    businessTime: isoOrNull(r.businessTime) ?? r.businessTime,
    createdRevision: r.createdRevision,
    replyCount: mine.length,
    lastReplyAt: last,
    resolution: r.resolution,
    resolvedBy: actorView(packet, r.resolvedBy),
    resolvedRevision: r.resolvedRevision,
  };
}

function recipients(ctx: SessionContext, asOf: string): RequestsView["recipients"] {
  const packet = ctx.packet.packet;
  return {
    clients: packet.firm.client_users.map((c) => ({ id: c.id, name: c.name, role: "client" })),
    staff: packet.firm.staff
      .filter((s) => s.id !== ctx.actor.id)
      .map((s) => ({ id: s.id, name: s.name, role: s.role.replace(/_/g, " "), available: isAvailableAt(findActor(packet, s.id)!, asOf) })),
  };
}

export async function requestsView(ctx: SessionContext, filters: RequestsFilters = {}): Promise<RequestsView | Refusal> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const redact = makeRedactor(ctx.packet.packet);
  const asOf = clockIso(ctx);
  const wsId = ctx.workspace.id;
  const [rows, replies] = await Promise.all([
    ctx.db.select().from(t.requests).where(eq(t.requests.workspaceId, wsId)).orderBy(desc(t.requests.createdRevision), desc(t.requests.createdAt)),
    ctx.db.select().from(t.requestReplies).where(eq(t.requestReplies.workspaceId, wsId)),
  ]);
  const all = rows.map((r) => requestRow(ctx, asOf, r, replies));
  const status = REQUEST_STATUSES.includes(filters.status as RequestStatus) ? (filters.status as RequestStatus) : null;
  const kind = filters.kind && filters.kind in REQUEST_KIND_LABELS ? filters.kind : null;
  const counts: Record<RequestStatus, number> = { open: 0, answered: 0, resolved: 0, withdrawn: 0 };
  for (const r of all) counts[r.status] += 1;
  const requests = all.filter((r) => (!status || r.status === status) && (!kind || r.kind === kind));
  const view: RequestsView = {
    asOf,
    revision: ctx.workspace.revision,
    actor: { ...selfView(ctx), canCreate: can(ctx.actor, "raise_finding") },
    requests,
    counts,
    total: all.length,
    overdue: all.filter((r) => r.overdue).length,
    filters: { status, kind },
    recipients: recipients(ctx, asOf),
    areas: AREAS.map((a) => ({ id: a.id, label: a.label })),
    kinds: Object.entries(REQUEST_KIND_LABELS).map(([value, label]) => ({ value, label })),
  };
  return redact.deep(view);
}

export interface AttachmentView {
  id: string;
  ref: string;
  kind: string;
  filename: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  provenance: string;
  uploadedBy: ActorView;
  businessTime: string;
  createdRevision: number;
  /** Download route (served by the attachments API). */
  href: string;
  linkedRefs: RefView[];
}

export interface ReplyView {
  id: string;
  ref: string;
  author: ActorView;
  body: string;
  businessTime: string;
  createdRevision: number;
  attachments: AttachmentView[];
}

export interface CitationView {
  table: "adjustment" | "finding" | "judgment" | "verification" | "task";
  id: string;
  ref: string;
  label: string;
  status: string;
  actor: ActorView;
  createdRevision: number;
}

export interface EvidenceProduced {
  ref: string;
  kind: "reply" | "attachment";
  label: string;
  citedBy: CitationView[];
}

export interface RequestDetail {
  asOf: string;
  revision: number;
  request: RequestRow;
  thread: ReplyView[];
  /** Attachments filed against the request that no reply has carried yet. */
  pendingAttachments: AttachmentView[];
  evidence: EvidenceProduced[];
  actor: ActorView & { canReply: boolean; canResolve: boolean; canAttach: boolean };
}

function attachmentView(ctx: SessionContext, asOf: string, a: typeof t.attachments.$inferSelect): AttachmentView {
  const packet = ctx.packet.packet;
  return {
    id: a.id,
    ref: `attachment:${a.id}`,
    kind: a.kind,
    filename: a.filename,
    contentType: a.contentType,
    byteLength: a.byteLength,
    sha256: a.sha256,
    provenance: a.provenance.replace(/_/g, " "),
    uploadedBy: actorOrUnknown(packet, a.uploadedBy),
    businessTime: isoOrNull(a.businessTime) ?? a.businessTime,
    createdRevision: a.createdRevision,
    href: `/api/attachments/${encodeURIComponent(a.id)}`,
    linkedRefs: a.linkedRefs.map((r) => refView(packet, ctx.workspace.activeVersion, asOf, r)),
  };
}

function citationsOf(packet: Packet, state: WorkspaceState, tasks: (typeof t.tasks.$inferSelect)[], ref: string): CitationView[] {
  const out: CitationView[] = [];
  for (const a of state.adjustments) {
    if (!a.evidenceRefs.includes(ref)) continue;
    out.push({ table: "adjustment", id: a.id, ref: `adjustment:${a.id}`, label: `Adjustment on ${a.targetRef}: ${a.reason}`, status: a.status, actor: actorOrUnknown(packet, a.authorId), createdRevision: a.createdRevision });
  }
  for (const f of state.findings) {
    if (!f.refs.includes(ref)) continue;
    out.push({ table: "finding", id: f.id, ref: `finding:${f.id}`, label: `Finding: ${f.title}`, status: f.status, actor: actorOrUnknown(packet, f.createdBy), createdRevision: f.createdRevision });
  }
  for (const j of state.judgments) {
    if (!j.evidenceRefs.includes(ref)) continue;
    out.push({ table: "judgment", id: j.id, ref: `judgment:${j.id}`, label: `${kindLabel(JUDGMENT_KIND_LABELS, j.kind)} on ${j.subjectRef}: ${j.title}`, status: j.status, actor: actorOrUnknown(packet, j.decidedBy), createdRevision: j.createdRevision });
  }
  for (const v of state.verifications) {
    if (!v.evidenceRefs.includes(ref)) continue;
    out.push({ table: "verification", id: v.id, ref: `verification:${v.id}`, label: `Verification of ${v.subjectRef} (${v.method.replace(/_/g, " ")})`, status: v.conclusion, actor: actorOrUnknown(packet, v.actorId), createdRevision: v.createdRevision });
  }
  for (const task of tasks) {
    if (!(task.completionRefs ?? []).includes(ref) && !task.refs.includes(ref)) continue;
    out.push({ table: "task", id: task.id, ref: `task:${task.id}`, label: `Task: ${task.title}`, status: task.status, actor: actorOrUnknown(packet, task.ownerId), createdRevision: task.createdRevision });
  }
  return out.sort((a, b) => a.createdRevision - b.createdRevision);
}

export const JUDGMENT_KIND_LABELS: Record<string, string> = {
  judgment: "Judgment call",
  election: "Election",
  due_diligence: "Due diligence",
  penalty_decision: "Penalty decision",
};

export async function requestDetail(ctx: SessionContext, requestId: string): Promise<RequestDetail | Refusal | null> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const wsId = ctx.workspace.id;
  const [row] = await ctx.db.select().from(t.requests).where(and(eq(t.requests.workspaceId, wsId), eq(t.requests.id, requestId)));
  if (!row) return null;
  const [replies, attachments, state, tasks] = await Promise.all([
    ctx.db.select().from(t.requestReplies).where(and(eq(t.requestReplies.workspaceId, wsId), eq(t.requestReplies.requestId, requestId))).orderBy(asc(t.requestReplies.createdRevision), asc(t.requestReplies.createdAt)),
    ctx.db.select().from(t.attachments).where(and(eq(t.attachments.workspaceId, wsId), eq(t.attachments.requestId, requestId))).orderBy(asc(t.attachments.createdRevision)),
    loadWorkspaceState(ctx.db, ctx),
    ctx.db.select().from(t.tasks).where(eq(t.tasks.workspaceId, wsId)),
  ]);
  const byId = new Map(attachments.map((a) => [a.id, attachmentView(ctx, asOf, a)]));
  const carried = new Set<string>();
  const thread: ReplyView[] = replies.map((r) => {
    const atts = r.attachmentIds.map((id) => byId.get(id)).filter((a): a is AttachmentView => Boolean(a));
    for (const a of atts) carried.add(a.id);
    return {
      id: r.id,
      ref: `reply:${r.id}`,
      author: actorOrUnknown(packet, r.authorId),
      body: r.body,
      businessTime: isoOrNull(r.businessTime) ?? r.businessTime,
      createdRevision: r.createdRevision,
      attachments: atts,
    };
  });
  const pendingAttachments = [...byId.values()].filter((a) => !carried.has(a.id));
  const evidence: EvidenceProduced[] = [
    ...thread.map<EvidenceProduced>((r) => ({ ref: r.ref, kind: "reply", label: `Reply by ${r.author.name} on ${r.businessTime.slice(0, 10)}`, citedBy: citationsOf(packet, state, tasks, r.ref) })),
    ...[...byId.values()].map<EvidenceProduced>((a) => ({ ref: a.ref, kind: "attachment", label: `${a.kind} "${a.filename}" (${a.byteLength} bytes)`, citedBy: citationsOf(packet, state, tasks, a.ref) })),
  ];
  const request = requestRow(ctx, asOf, row, replies);
  const live = request.status === "open" || request.status === "answered";
  const view: RequestDetail = {
    asOf,
    revision: ctx.workspace.revision,
    request,
    thread,
    pendingAttachments,
    evidence,
    actor: {
      ...selfView(ctx),
      canReply: live,
      canResolve: live && can(ctx.actor, "raise_finding"),
      canAttach: live && can(ctx.actor, "add_verification"),
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Tasks                                                                     */
/* ------------------------------------------------------------------------ */

export type TaskStatus = "open" | "done" | "cancelled";
export const TASK_STATUSES: TaskStatus[] = ["open", "done", "cancelled"];

export interface TaskRow {
  id: string;
  ref: string;
  kind: string;
  kindLabel: string;
  title: string;
  detail: string;
  owner: ActorView;
  dueAt: string | null;
  overdue: boolean;
  status: TaskStatus;
  refs: RefView[];
  area: string;
  areaLabel: string;
  createdBy: ActorView;
  createdRevision: number;
  completedBy: ActorView | null;
  completedRevision: number | null;
  completionNote: string | null;
  completionRefs: RefView[];
  /** The viewer owns this task. */
  mine: boolean;
  /** The viewer may complete it (owner, or holds manage_assignments). */
  canComplete: boolean;
}

export interface TasksFilters {
  status?: string;
  kind?: string;
  mine?: boolean;
  overdue?: boolean;
}

export interface TasksView {
  asOf: string;
  revision: number;
  actor: ActorView & { canCreate: boolean };
  /** Tasks other than outside filings, after the filters. */
  tasks: TaskRow[];
  /** Outside filings, after the filters, in their own group. */
  outsideFilings: TaskRow[];
  counts: Record<TaskStatus, number> & { overdue: number; mine: number; total: number };
  filters: { status: TaskStatus | null; kind: string | null; mine: boolean; overdue: boolean };
  owners: (ActorView & { available: boolean })[];
  areas: { id: string; label: string }[];
  kinds: { value: string; label: string }[];
  /** Why outside filings exist on this engagement, from the packet. */
  packetContext: { deadlines: { what: string; date: string; daysFromClock: number }[]; refs: RefView[]; note: string };
}

export function taskRow(ctx: SessionContext, asOf: string, task: typeof t.tasks.$inferSelect): TaskRow {
  const packet = ctx.packet.packet;
  const version = ctx.workspace.activeVersion;
  const dueAt = isoOrNull(task.dueAt);
  const status = task.status as TaskStatus;
  const mine = task.ownerId === ctx.actor.id;
  return {
    id: task.id,
    ref: `task:${task.id}`,
    kind: task.kind,
    kindLabel: kindLabel(TASK_KIND_LABELS, task.kind),
    title: task.title,
    detail: task.detail,
    owner: actorOrUnknown(packet, task.ownerId),
    dueAt,
    overdue: status === "open" && isPast(dueAt, asOf),
    status,
    refs: task.refs.map((r) => refView(packet, version, asOf, r)),
    area: task.area,
    areaLabel: areaLabel(task.area),
    createdBy: actorOrUnknown(packet, task.createdBy),
    createdRevision: task.createdRevision,
    completedBy: actorView(packet, task.completedBy),
    completedRevision: task.completedRevision,
    completionNote: task.completionNote,
    completionRefs: (task.completionRefs ?? []).map((r) => refView(packet, version, asOf, r)),
    mine,
    canComplete: status === "open" && (mine || can(ctx.actor, "manage_assignments")),
  };
}

function daysBetween(fromIso: string, dateOnly: string): number {
  const from = new Date(fromIso);
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round((Date.parse(`${dateOnly}T00:00:00Z`) - start) / 86_400_000);
}

export async function tasksView(ctx: SessionContext, filters: TasksFilters = {}): Promise<TasksView | Refusal> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const rows = await ctx.db.select().from(t.tasks).where(eq(t.tasks.workspaceId, ctx.workspace.id)).orderBy(desc(t.tasks.createdRevision), desc(t.tasks.createdAt));
  const all = rows.map((r) => taskRow(ctx, asOf, r));
  const status = TASK_STATUSES.includes(filters.status as TaskStatus) ? (filters.status as TaskStatus) : null;
  const kind = filters.kind && filters.kind in TASK_KIND_LABELS ? filters.kind : null;
  const mine = Boolean(filters.mine);
  const overdue = Boolean(filters.overdue);
  const counts: TasksView["counts"] = { open: 0, done: 0, cancelled: 0, overdue: 0, mine: 0, total: all.length };
  for (const r of all) {
    counts[r.status] += 1;
    if (r.overdue) counts.overdue += 1;
    if (r.mine && r.status === "open") counts.mine += 1;
  }
  const matched = all.filter((r) => (!status || r.status === status) && (!kind || r.kind === kind) && (!mine || r.mine) && (!overdue || r.overdue));
  const order = (a: TaskRow, b: TaskRow) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999") || b.createdRevision - a.createdRevision;
  const packetRefs = ["F8938.1.max", "call-01", "D27", "SchC.I"];
  const deadlines = packet.firm.deadlines.filter((d) => /outside engagement/i.test(d.what)).map((d) => ({ what: d.what, date: d.date, daysFromClock: daysBetween(asOf, d.date) }));
  const view: TasksView = {
    asOf,
    revision: ctx.workspace.revision,
    actor: { ...selfView(ctx), canCreate: can(ctx.actor, "raise_finding") },
    tasks: matched.filter((r) => r.kind !== "outside_filing").sort(order),
    outsideFilings: matched.filter((r) => r.kind === "outside_filing").sort(order),
    counts,
    filters: { status, kind, mine, overdue },
    owners: packet.firm.staff.map((s) => ({ id: s.id, name: s.name, role: s.role.replace(/_/g, " "), available: isAvailableAt(findActor(packet, s.id)!, asOf) })),
    areas: AREAS.map((a) => ({ id: a.id, label: a.label })),
    kinds: Object.entries(TASK_KIND_LABELS).map(([value, label]) => ({ value, label })),
    packetContext: {
      deadlines,
      refs: packetRefs.map((r) => refView(packet, ctx.workspace.activeVersion, asOf, r)),
      note: "The foreign account (FBAR, FinCEN 114) and the two unfiled contractor Forms 1099-NEC are filings outside this return. They are tracked here so they are not forgotten; marking one done needs evidence of the filing or the client's acknowledgment.",
    },
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Inbox                                                                     */
/* ------------------------------------------------------------------------ */

export interface NotificationView {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string;
  refs: RefView[];
  createdAt: string;
  createdRevision: number;
  readAt: string | null;
  unread: boolean;
}

export interface InboxView {
  revision: number;
  actor: ActorView;
  notifications: NotificationView[];
  unread: number;
  total: number;
}

/** Unread notifications addressed to the current actor. Safe for any role: it is only a count. */
export async function unreadCount(ctx: SessionContext): Promise<number> {
  const rows = await ctx.db
    .select({ id: t.notifications.id })
    .from(t.notifications)
    .where(and(eq(t.notifications.workspaceId, ctx.workspace.id), eq(t.notifications.recipientId, ctx.actor.id), isNull(t.notifications.readAt)));
  return rows.length;
}

export async function inboxView(ctx: SessionContext): Promise<InboxView | Refusal> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const rows = await ctx.db
    .select()
    .from(t.notifications)
    .where(and(eq(t.notifications.workspaceId, ctx.workspace.id), eq(t.notifications.recipientId, ctx.actor.id)))
    .orderBy(desc(t.notifications.createdRevision), desc(t.notifications.createdAt));
  const notifications: NotificationView[] = rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    kindLabel: kindLabel(NOTIFICATION_KIND_LABELS, n.kind),
    title: n.title,
    body: n.body,
    refs: n.refs.map((r) => refView(packet, ctx.workspace.activeVersion, asOf, r)),
    createdAt: isoOrNull(n.createdAt) ?? n.createdAt,
    createdRevision: n.createdRevision,
    readAt: isoOrNull(n.readAt),
    unread: n.readAt === null,
  }));
  const view: InboxView = {
    revision: ctx.workspace.revision,
    actor: selfView(ctx),
    notifications,
    unread: notifications.filter((n) => n.unread).length,
    total: notifications.length,
  };
  return redact.deep(view);
}

/* ------------------------------------------------------------------------ */
/* Time                                                                      */
/* ------------------------------------------------------------------------ */

export interface BudgetRow {
  areaId: string;
  label: string;
  /** Null when the firm set no budget for the area. */
  budget: number | null;
  logged: number;
  remaining: number | null;
  percent: number | null;
  over: boolean;
}

export interface TimeEntryView {
  id: string;
  actor: ActorView;
  area: string;
  areaLabel: string;
  workDate: string;
  hours: number;
  note: string | null;
  createdRevision: number;
  mine: boolean;
}

export interface EngagementStatus {
  workflowState: string;
  filingLocked: boolean;
  activeVersion: string;
  asOf: string;
  openFindings: number;
  blockers: number;
  openRequests: number;
  overdueRequests: number;
  openTasks: number;
  overdueTasks: number;
}

export interface TimeView {
  asOf: string;
  revision: number;
  actor: ActorView & { canLog: boolean };
  budget: { rows: BudgetRow[]; totalBudget: number; totalLogged: number; totalRemaining: number };
  entries: TimeEntryView[];
  areas: { id: string; label: string }[];
  /** The replay clock's date, the default for a new entry. */
  defaultDate: string;
  status: EngagementStatus;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function timeView(ctx: SessionContext): Promise<TimeView | Refusal> {
  const refused = refusalFor(ctx);
  if (refused) return refused;
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const asOf = clockIso(ctx);
  const wsId = ctx.workspace.id;
  const [entries, state, requests, tasks] = await Promise.all([
    ctx.db.select().from(t.timeEntries).where(eq(t.timeEntries.workspaceId, wsId)).orderBy(desc(t.timeEntries.workDate), desc(t.timeEntries.createdRevision)),
    loadWorkspaceState(ctx.db, ctx),
    ctx.db.select().from(t.requests).where(eq(t.requests.workspaceId, wsId)),
    ctx.db.select().from(t.tasks).where(eq(t.tasks.workspaceId, wsId)),
  ]);
  const logged = new Map<string, number>();
  for (const e of entries) logged.set(e.area, round2((logged.get(e.area) ?? 0) + Number(e.hours)));
  const rows: BudgetRow[] = AREAS.map((a) => {
    const budget = a.budgetKey && typeof packet.firm.budget_hours[a.budgetKey] === "number" ? packet.firm.budget_hours[a.budgetKey] : null;
    const used = logged.get(a.id) ?? 0;
    const remaining = budget === null ? null : round2(budget - used);
    const percent = budget === null || budget === 0 ? null : Math.round((used / budget) * 100);
    return { areaId: a.id, label: a.label, budget, logged: used, remaining, percent, over: budget !== null && used > budget };
  });
  const totalBudget = round2(rows.reduce((s, r) => s + (r.budget ?? 0), 0));
  const totalLogged = round2(rows.reduce((s, r) => s + r.logged, 0));
  const openRequests = requests.filter((r) => r.status === "open" || r.status === "answered");
  const openTasks = tasks.filter((x) => x.status === "open");
  const view: TimeView = {
    asOf,
    revision: ctx.workspace.revision,
    actor: { ...selfView(ctx), canLog: true },
    budget: { rows, totalBudget, totalLogged, totalRemaining: round2(totalBudget - totalLogged) },
    entries: entries.map((e) => ({
      id: e.id,
      actor: actorOrUnknown(packet, e.actorId),
      area: e.area,
      areaLabel: areaLabel(e.area),
      workDate: e.workDate,
      hours: Number(e.hours),
      note: e.note,
      createdRevision: e.createdRevision,
      mine: e.actorId === ctx.actor.id,
    })),
    areas: AREAS.map((a) => ({ id: a.id, label: a.label })),
    defaultDate: asOf.slice(0, 10),
    status: {
      workflowState: ctx.workspace.workflowState,
      filingLocked: ctx.workspace.filingLocked,
      activeVersion: ctx.workspace.activeVersion,
      asOf,
      openFindings: state.findings.filter((f) => f.status === "open").length,
      blockers: state.findings.filter((f) => f.status === "open" && f.blocksFiling).length,
      openRequests: openRequests.length,
      overdueRequests: openRequests.filter((r) => isPast(isoOrNull(r.dueAt), asOf)).length,
      openTasks: openTasks.length,
      overdueTasks: openTasks.filter((x) => isPast(isoOrNull(x.dueAt), asOf)).length,
    },
  };
  return redact.deep(view);
}
