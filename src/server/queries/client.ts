/**
 * Read model for the client portal. A client sees only what concerns them:
 * their own notifications, the requests addressed to them with the thread of
 * replies and attachments, the presented return in plain language, their
 * approval status and, after submission, the status of each filing.
 *
 * This module never loads findings, review notes, sign-offs, judgments,
 * scope contributions or the audit log: not filtered out, simply never read.
 * Every packet-derived string is redacted before it leaves.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as t from "@/db/schema";
import { findActor } from "@/domain/policy";
import { makeRedactor, type Redactor } from "@/domain/redaction";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef } from "@/packet/refs";
import type { Packet } from "@/packet/types";
import type { SessionContext } from "@/server/context";
import type { SnapshotPayload } from "@/server/presentation";
import type { Db } from "@/db/client";

/* ------------------------------------------------------------------------ */
/* Shared helpers (also used by the exports)                                  */
/* ------------------------------------------------------------------------ */

export function personName(packet: Packet, id: string | null | undefined): string {
  if (!id) return "";
  if (id === "system") return "The firm";
  if (id === "engine") return "The engine";
  return findActor(packet, id)?.name ?? id;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function iso(value: string): string {
  return isoOrNull(value) ?? value;
}

/**
 * Plain-text labels for evidence references: document titles and pages,
 * client answers, replies and attachments by name. Never an app link. The
 * workpaper records are looked up in the workspace so a reply or attachment
 * is named by who wrote it and what it is called.
 */
export async function evidenceTexts(db: Db, packet: Packet, workspaceId: string, version: string, refs: string[], redact: Redactor): Promise<{ ref: string; text: string }[]> {
  const replyIds = refs.map(parseRef).filter((p) => p.kind === "workpaper" && p.table === "reply").map((p) => (p as { id: string }).id);
  const attachmentIds = refs.map(parseRef).filter((p) => p.kind === "workpaper" && p.table === "attachment").map((p) => (p as { id: string }).id);
  const [replies, attachments] = await Promise.all([
    replyIds.length ? db.select().from(t.requestReplies).where(and(eq(t.requestReplies.workspaceId, workspaceId), inArray(t.requestReplies.id, replyIds))) : Promise.resolve([]),
    attachmentIds.length
      ? db
          .select({ id: t.attachments.id, filename: t.attachments.filename, kind: t.attachments.kind, uploadedBy: t.attachments.uploadedBy, businessTime: t.attachments.businessTime })
          .from(t.attachments)
          .where(and(eq(t.attachments.workspaceId, workspaceId), inArray(t.attachments.id, attachmentIds)))
      : Promise.resolve([]),
  ]);
  const idx = indexPacket(packet);
  return refs.map((ref) => {
    const parsed = parseRef(ref);
    if (parsed.kind === "workpaper") {
      if (parsed.table === "reply") {
        const r = replies.find((x) => x.id === parsed.id);
        return { ref, text: r ? `Reply from ${personName(packet, r.authorId)} on ${iso(r.businessTime).slice(0, 10)}: "${redact.text(r.body).slice(0, 160)}"` : `Reply ${parsed.id}` };
      }
      if (parsed.table === "attachment") {
        const a = attachments.find((x) => x.id === parsed.id);
        return { ref, text: a ? `Attachment "${redact.text(a.filename)}" (${a.kind}) from ${personName(packet, a.uploadedBy)} on ${iso(a.businessTime).slice(0, 10)}` : `Attachment ${parsed.id}` };
      }
      return { ref, text: `${parsed.table.replace(/_/g, " ")} ${parsed.id}` };
    }
    if (parsed.kind === "line") {
      const line = idx.linesByVersion.get(version)?.get(parsed.key);
      return { ref, text: line ? `${line.form} line ${line.line}: ${redact.text(line.label)}` : ref };
    }
    const r = resolveRef(packet, ref, { version });
    return { ref, text: redact.text(r.label) };
  });
}

/* ------------------------------------------------------------------------ */
/* View model types                                                           */
/* ------------------------------------------------------------------------ */

export interface ClientNotificationView {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  /** Requests this notification points at, for jumping to the thread. */
  requestIds: string[];
}

export interface ClientAttachmentView {
  id: string;
  kind: string;
  filename: string;
  contentType: string;
  byteLength: number;
  uploadedByName: string;
  businessTime: string;
  href: string;
}

export interface ClientReplyView {
  id: string;
  authorName: string;
  mine: boolean;
  body: string;
  businessTime: string;
  attachments: ClientAttachmentView[];
}

export interface ClientRequestView {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  body: string;
  fromName: string;
  dueAt: string | null;
  status: string;
  open: boolean;
  askedAt: string;
  /** What the question is about, in words (never an app link). */
  about: string[];
  replies: ClientReplyView[];
  /** Attachments on the request that are not yet part of a reply. */
  pendingAttachments: ClientAttachmentView[];
  resolution: string | null;
}

export interface PresentedChangeView {
  id: string;
  line: string;
  lineLabel: string;
  kind: string;
  from: unknown;
  to: unknown;
  fromLabel: string | null;
  toLabel: string | null;
  reason: string;
  evidence: string[];
  effectFederal: number | null;
  effectCalifornia: number | null;
  effectStatus: string;
  limitations: string[];
}

export interface ClientApprovalStatus {
  personId: string;
  personName: string;
  mine: boolean;
  status: "approved" | "invalidated" | "pending";
  signedAt: string | null;
  invalidationReason: string | null;
}

export interface PresentationView {
  snapshotId: string;
  kind: string;
  contentHash: string;
  revision: number;
  presentedAt: string;
  version: string;
  baseline: { federal: Record<string, number>; california: Record<string, number> };
  changes: PresentedChangeView[];
  effects: { federal: number; california: number; balanceFederal: number; balanceCalifornia: number };
  limitations: string[];
  note: string;
  approvals: ClientApprovalStatus[];
  /** The viewer may approve now: the return is presented, and they have not approved this presentation yet. */
  canApprove: boolean;
  approveBlockedReason: string | null;
}

export interface ClientFilingView {
  jurisdiction: string;
  jurisdictionLabel: string;
  attempt: number;
  status: string;
  statusLabel: string;
  simulated: boolean;
  submittedAt: string;
  decidedAt: string | null;
  errors: { code: string; message: string }[];
}

export interface ClientView {
  revision: number;
  asOf: string;
  viewer: { id: string; name: string; role: string };
  workspace: { id: string; name: string; state: string; stateLabel: string };
  household: { taxYear: number; filingStatus: string; taxpayer: string; spouse: string | null };
  inbox: ClientNotificationView[];
  unreadCount: number;
  requests: ClientRequestView[];
  presentation: PresentationView | null;
  filings: ClientFilingView[];
  clientCopy: { snapshotId: string; kind: string; htmlHref: string; jsonHref: string } | null;
}

/* ------------------------------------------------------------------------ */
/* Builders                                                                   */
/* ------------------------------------------------------------------------ */

const CLIENT_STATE_LABELS: Record<string, string> = {
  preparing: "Your return is being prepared",
  ready_for_client: "Your return is ready for your review and approval",
  authorized: "Approved by both of you; the firm will submit it",
  submitted: "Submitted to the tax agencies (simulated)",
  rejected: "A submission was rejected; the firm is correcting it",
  accepted: "Accepted by both tax agencies (simulated)",
  amending: "An amended return is being prepared",
};

const REQUEST_KIND_LABELS: Record<string, string> = {
  client_question: "Question",
  document_request: "Document request",
  colleague_question: "Question",
};

const SUBMISSION_STATUS_LABELS: Record<string, string> = {
  submitted: "Transmitted, waiting for the agency (simulated)",
  accepted: "Accepted (simulated)",
  rejected: "Rejected (simulated)",
  not_transmitted: "Held until the federal return is accepted",
};

export const CLIENT_COPY_KINDS = ["client_ready", "submission", "accepted"] as const;

function attachmentView(packet: Packet, redact: Redactor, a: typeof t.attachments.$inferSelect): ClientAttachmentView {
  return {
    id: a.id,
    kind: a.kind,
    filename: redact.text(a.filename),
    contentType: a.contentType,
    byteLength: a.byteLength,
    uploadedByName: personName(packet, a.uploadedBy),
    businessTime: iso(a.businessTime),
    href: `/api/attachments/${encodeURIComponent(a.id)}`,
  };
}

interface PayloadAdjustment {
  id: string;
  targetRef: string;
  kind: string;
  priorValue: unknown;
  proposedValue: unknown;
  proposedLabel: string | null;
  reason: string;
  evidenceRefs: string[];
  effectFederal: string | number | null;
  effectCalifornia: string | number | null;
  effectStatus: string;
  limitations: string[];
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** The accepted changes of a frozen presentation in plain language, with evidence named as text. */
export async function presentedChanges(db: Db, packet: Packet, workspaceId: string, payload: SnapshotPayload, redact: Redactor): Promise<PresentedChangeView[]> {
  const lines = new Map(payload.lines.map((l) => [l.key, l]));
  const out: PresentedChangeView[] = [];
  for (const raw of payload.acceptedAdjustments as PayloadAdjustment[]) {
    const line = lines.get(raw.targetRef);
    const evidence = await evidenceTexts(db, packet, workspaceId, payload.version, raw.evidenceRefs ?? [], redact);
    out.push({
      id: raw.id,
      line: raw.targetRef,
      lineLabel: line ? `${line.form} line ${line.line}: ${redact.text(line.label)}` : raw.targetRef,
      kind: raw.kind,
      from: redact.deep(raw.priorValue),
      to: redact.deep(raw.proposedValue),
      fromLabel: raw.kind === "label" && line ? redact.text(String(line.label)) : null,
      toLabel: raw.kind === "label" ? (raw.proposedLabel === null ? null : redact.text(raw.proposedLabel)) : null,
      reason: redact.text(raw.reason),
      evidence: evidence.map((e) => e.text),
      effectFederal: numOrNull(raw.effectFederal),
      effectCalifornia: numOrNull(raw.effectCalifornia),
      effectStatus: raw.effectStatus,
      limitations: (raw.limitations ?? []).map((l) => redact.text(l)),
    });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* The view                                                                   */
/* ------------------------------------------------------------------------ */

export async function clientView(ctx: SessionContext): Promise<ClientView> {
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const db = ctx.db;
  const wsId = ctx.workspace.id;
  const me = ctx.actor;
  const asOf = iso(ctx.workspace.asOf);
  const wf = ctx.workspace.workflowState;

  const [notifications, requests, clientReady, approvals, submissions, latestSubmissionSnap, latestAcceptedSnap] = await Promise.all([
    db
      .select()
      .from(t.notifications)
      .where(and(eq(t.notifications.workspaceId, wsId), eq(t.notifications.recipientId, me.id)))
      .orderBy(desc(t.notifications.createdRevision), desc(t.notifications.createdAt)),
    db
      .select()
      .from(t.requests)
      .where(and(eq(t.requests.workspaceId, wsId), eq(t.requests.toActorId, me.id)))
      .orderBy(desc(t.requests.createdRevision)),
    db
      .select()
      .from(t.filingSnapshots)
      .where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "client_ready")))
      .orderBy(desc(t.filingSnapshots.revision), desc(t.filingSnapshots.createdAt))
      .limit(1),
    db.select().from(t.clientApprovals).where(eq(t.clientApprovals.workspaceId, wsId)).orderBy(asc(t.clientApprovals.createdRevision)),
    db.select().from(t.submissions).where(eq(t.submissions.workspaceId, wsId)).orderBy(asc(t.submissions.createdRevision), desc(t.submissions.jurisdiction)),
    db
      .select({ id: t.filingSnapshots.id, kind: t.filingSnapshots.kind })
      .from(t.filingSnapshots)
      .where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "submission")))
      .orderBy(desc(t.filingSnapshots.revision))
      .limit(1),
    db
      .select({ id: t.filingSnapshots.id, kind: t.filingSnapshots.kind })
      .from(t.filingSnapshots)
      .where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "accepted")))
      .orderBy(desc(t.filingSnapshots.revision))
      .limit(1),
  ]);

  const requestIds = requests.map((r) => r.id);
  const [replies, attachments] = await Promise.all([
    requestIds.length
      ? db
          .select()
          .from(t.requestReplies)
          .where(and(eq(t.requestReplies.workspaceId, wsId), inArray(t.requestReplies.requestId, requestIds)))
          .orderBy(asc(t.requestReplies.createdRevision))
      : Promise.resolve([]),
    requestIds.length
      ? db
          .select()
          .from(t.attachments)
          .where(and(eq(t.attachments.workspaceId, wsId), inArray(t.attachments.requestId, requestIds)))
          .orderBy(asc(t.attachments.createdRevision))
      : Promise.resolve([]),
  ]);

  const inbox = notifications.map<ClientNotificationView>((n) => ({
    id: n.id,
    kind: n.kind,
    title: redact.text(n.title),
    body: redact.text(n.body),
    createdAt: iso(n.createdAt),
    read: n.readAt !== null,
    requestIds: n.refs.map(parseRef).filter((p) => p.kind === "workpaper" && p.table === "request").map((p) => (p as { id: string }).id),
  }));

  const requestViews: ClientRequestView[] = [];
  for (const r of requests) {
    const about = await evidenceTexts(db, packet, wsId, ctx.workspace.activeVersion, r.refs, redact);
    const replyViews = replies
      .filter((x) => x.requestId === r.id)
      .map<ClientReplyView>((x) => ({
        id: x.id,
        authorName: personName(packet, x.authorId),
        mine: x.authorId === me.id,
        body: redact.text(x.body),
        businessTime: iso(x.businessTime),
        attachments: x.attachmentIds.map((id) => attachments.find((a) => a.id === id)).filter((a): a is typeof t.attachments.$inferSelect => Boolean(a)).map((a) => attachmentView(packet, redact, a)),
      }));
    const inReplies = new Set(replyViews.flatMap((x) => x.attachments.map((a) => a.id)));
    requestViews.push({
      id: r.id,
      kind: r.kind,
      kindLabel: REQUEST_KIND_LABELS[r.kind] ?? r.kind.replace(/_/g, " "),
      title: redact.text(r.title),
      body: redact.text(r.body),
      fromName: personName(packet, r.fromActorId),
      dueAt: isoOrNull(r.dueAt),
      status: r.status,
      open: r.status === "open" || r.status === "answered",
      askedAt: iso(r.businessTime),
      about: about.map((a) => a.text),
      replies: replyViews,
      pendingAttachments: attachments.filter((a) => a.requestId === r.id && !inReplies.has(a.id)).map((a) => attachmentView(packet, redact, a)),
      resolution: r.resolution === null ? null : redact.text(r.resolution),
    });
  }

  const presentedStates = ["ready_for_client", "authorized", "submitted", "rejected", "accepted"];
  let presentation: PresentationView | null = null;
  const snap = clientReady[0];
  if (snap && presentedStates.includes(wf)) {
    const payload = snap.payload as SnapshotPayload;
    const changes = await presentedChanges(db, packet, wsId, payload, redact);
    const forSnapshot = approvals.filter((a) => a.snapshotId === snap.id);
    const statuses = packet.firm.client_users.map<ClientApprovalStatus>((c) => {
      const rows = forSnapshot.filter((a) => a.personId === c.id);
      const approved = rows.find((a) => a.status === "approved");
      const latest = rows[rows.length - 1];
      if (approved) return { personId: c.id, personName: c.name, mine: c.id === me.id, status: "approved", signedAt: iso(approved.signedAt), invalidationReason: null };
      if (latest && latest.status === "invalidated")
        return { personId: c.id, personName: c.name, mine: c.id === me.id, status: "invalidated", signedAt: iso(latest.signedAt), invalidationReason: latest.invalidationReason === null ? null : redact.text(latest.invalidationReason) };
      return { personId: c.id, personName: c.name, mine: c.id === me.id, status: "pending", signedAt: null, invalidationReason: null };
    });
    const mine = statuses.find((s) => s.personId === me.id);
    let blocked: string | null = null;
    if (me.role !== "client") blocked = "Only the clients approve their return.";
    else if (wf !== "ready_for_client") blocked = wf === "authorized" ? "Both approvals are in; nothing more is needed from you." : "This presentation has been approved and submitted; approval is closed.";
    else if (!mine) blocked = "You are not one of the people who must approve this return.";
    else if (mine.status === "approved") blocked = "You already approved this presentation.";
    presentation = {
      snapshotId: snap.id,
      kind: snap.kind,
      contentHash: snap.contentHash,
      revision: snap.revision,
      presentedAt: iso(snap.businessTime),
      version: payload.version,
      baseline: (redact.deep(payload.baselineSummary) as { federal: Record<string, number>; california: Record<string, number> }) ?? { federal: {}, california: {} },
      changes,
      effects: {
        federal: payload.estimatedEffects.federal,
        california: payload.estimatedEffects.california,
        balanceFederal: payload.estimatedEffects.balanceFederal,
        balanceCalifornia: payload.estimatedEffects.balanceCalifornia,
      },
      limitations: payload.estimatedEffects.limitations.map((l) => redact.text(l)),
      note: redact.text(payload.presentationNote),
      approvals: statuses,
      canApprove: blocked === null,
      approveBlockedReason: blocked,
    };
  }

  const filings = submissions.map<ClientFilingView>((s) => ({
    jurisdiction: s.jurisdiction,
    jurisdictionLabel: s.jurisdiction === "federal" ? "Federal (IRS)" : "California (FTB)",
    attempt: s.attempt,
    status: s.status,
    statusLabel: SUBMISSION_STATUS_LABELS[s.status] ?? s.status.replace(/_/g, " "),
    simulated: s.simulated,
    submittedAt: iso(s.submittedAt),
    decidedAt: isoOrNull(s.decidedAt),
    errors: s.errors.map((e) => ({ code: e.code, message: redact.text(e.message) })),
  }));

  const copySource = latestAcceptedSnap[0] ?? latestSubmissionSnap[0] ?? (presentation ? { id: presentation.snapshotId, kind: presentation.kind } : null);
  const clientCopy = copySource
    ? {
        snapshotId: copySource.id,
        kind: copySource.kind,
        htmlHref: `/api/export/client-copy?snapshot=${encodeURIComponent(copySource.id)}&format=html`,
        jsonHref: `/api/export/client-copy?snapshot=${encodeURIComponent(copySource.id)}&format=json`,
      }
    : null;

  const people = packet.household.people;
  const taxpayer = people.find((p) => p.role === "taxpayer");
  const spouse = people.find((p) => p.role === "spouse");
  return {
    revision: ctx.workspace.revision,
    asOf,
    viewer: { id: me.id, name: me.name, role: me.role },
    workspace: { id: wsId, name: redact.text(ctx.workspace.name), state: wf, stateLabel: CLIENT_STATE_LABELS[wf] ?? wf.replace(/_/g, " ") },
    household: {
      taxYear: packet.household.tax_year,
      filingStatus: packet.household.filing_status.replace(/_/g, " "),
      taxpayer: taxpayer ? redact.text(taxpayer.name) : "",
      spouse: spouse ? redact.text(spouse.name) : null,
    },
    inbox,
    unreadCount: inbox.filter((n) => !n.read).length,
    requests: requestViews,
    presentation,
    filings,
    clientCopy,
  };
}
