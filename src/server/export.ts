/**
 * Self-contained exports. Each one is an HTML document with inline CSS, no
 * scripts and no external resources, plus a JSON record with the same content,
 * so it can be read offline years later without the app. Evidence is written
 * out as text (document titles, pages and printed passages), never as links.
 *
 * Sensitive values never leave unmasked: every packet-derived string goes
 * through the redactor and identification shows SSNs as last four only.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import * as t from "@/db/schema";
import { makeRedactor, type Redactor } from "@/domain/redaction";
import { dateTime, money } from "@/lib/format";
import { indexPacket } from "@/packet/load";
import { parseRef, resolveRef } from "@/packet/refs";
import type { Packet, ReturnVersion } from "@/packet/types";
import type { SessionContext } from "./context";
import type { SnapshotPayload } from "./presentation";
import { evidenceTexts, personName, presentedChanges, type PresentedChangeView, CLIENT_COPY_KINDS } from "./queries/client";
import { packetNotices, noticeAvailableAt } from "./queries/filing";
import { loadWorkspaceState } from "./state";

export class ExportError extends Error {
  readonly code: "not_found" | "forbidden" | "unavailable";
  constructor(code: ExportError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------------------ */
/* Small helpers                                                              */
/* ------------------------------------------------------------------------ */

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "<span class=\"muted\">blank</span>";
  if (typeof value === "number") return `<span class="num">${esc(money(value))}</span>`;
  if (typeof value === "boolean") return value ? "yes" : "no";
  return esc(String(value));
}

function signedCell(value: number | null): string {
  if (value === null) return "<span class=\"muted\">unknown</span>";
  return `<span class="num">${esc(money(value, { signed: true }))}</span>`;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

function iso(value: string): string {
  return isoOrNull(value) ?? value;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CSS = `
:root { color-scheme: light; }
body { font-family: Georgia, "Times New Roman", serif; color: #1c1917; margin: 0; background: #fff; }
main { max-width: 960px; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 32px 0 8px; border-bottom: 1px solid #d6d3d1; padding-bottom: 4px; }
h3 { font-size: 14px; margin: 18px 0 6px; }
p { margin: 6px 0; line-height: 1.45; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 6px 0 12px; }
th, td { text-align: left; vertical-align: top; padding: 4px 8px; border-top: 1px solid #e7e5e4; }
th { font-weight: normal; color: #57534e; font-size: 12px; }
.num { font-family: "Courier New", Courier, monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
.muted { color: #78716c; }
.small { font-size: 12px; }
.badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 3px; background: #f5f5f4; color: #44403c; border: 1px solid #d6d3d1; }
.warn { background: #fffbeb; border: 1px solid #fcd34d; color: #78350f; padding: 10px 12px; border-radius: 4px; margin: 10px 0; }
.manifest { background: #fafaf9; border: 1px solid #d6d3d1; padding: 10px 12px; border-radius: 4px; font-size: 12px; }
.manifest dt { color: #57534e; display: inline-block; min-width: 160px; }
.manifest dd { display: inline; margin: 0; }
.manifest div { margin: 2px 0; }
pre.passage { white-space: pre-wrap; word-break: break-word; font-family: "Courier New", Courier, monospace; font-size: 12px; background: #fafaf9; border: 1px solid #e7e5e4; padding: 10px 12px; border-radius: 4px; }
ul { margin: 4px 0 8px; padding-left: 20px; }
li { margin: 2px 0; }
`;

function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function manifestBlock(rows: [string, string][]): string {
  return `<dl class="manifest">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join("")}</dl>`;
}

/* ------------------------------------------------------------------------ */
/* Client copy                                                                */
/* ------------------------------------------------------------------------ */

export interface ClientCopyRecord {
  manifest: {
    documentKind: "client_copy";
    workspaceId: string;
    snapshotId: string;
    snapshotKind: string;
    revision: number;
    contentHash: string;
    businessTime: string;
    generatedAt: string;
    version: string;
    standardsVersion: string;
    identificationNote: string;
    recordSha256: string;
  };
  identification: { taxYear: number; filingStatus: string; people: { role: string; name: string; ssnMasked: string }[] };
  baseline: { federal: Record<string, number>; california: Record<string, number> };
  forms: { form: string; jurisdiction: string; lines: { key: string; line: string; label: string; baseline: unknown; effective: unknown; status: string }[] }[];
  changes: PresentedChangeView[];
  effects: { federal: number; california: number; balanceFederal: number; balanceCalifornia: number };
  limitations: string[];
  presentationNote: string;
  approvals: { personName: string; signedAt: string; presentationHash: string; status: string; simulated: boolean; invalidationReason: string | null }[];
  submissions: { jurisdiction: string; attempt: number; status: string; submissionRef: string; simulated: boolean; submittedAt: string; decidedAt: string | null; errors: { code: string; message: string }[] }[];
}

export interface ClientCopy {
  snapshotId: string;
  kind: string;
  filename: string;
  html: string;
  json: ClientCopyRecord & { payload: unknown };
}

const STATUS_WORDS: Record<string, string> = {
  baseline: "engine value",
  adjusted: "changed by the firm",
  recomputed: "recomputed from a change",
  stale: "needs review after a change",
};

async function snapshotForViewer(ctx: SessionContext, snapshotId: string) {
  const [snap] = await ctx.db
    .select()
    .from(t.filingSnapshots)
    .where(and(eq(t.filingSnapshots.id, snapshotId), eq(t.filingSnapshots.workspaceId, ctx.workspace.id)));
  if (!snap) throw new ExportError("not_found", "No such snapshot in this workspace.");
  return snap;
}

export async function buildClientCopy(ctx: SessionContext, snapshotId: string): Promise<ClientCopy> {
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const snap = await snapshotForViewer(ctx, snapshotId);
  if (!(CLIENT_COPY_KINDS as readonly string[]).includes(snap.kind)) {
    throw new ExportError("forbidden", `A ${snap.kind.replace(/_/g, " ")} snapshot is not a client presentation.`);
  }
  const payload = snap.payload as SnapshotPayload;
  const [allSnapshots, approvalsRows, submissionRows] = await Promise.all([
    ctx.db.select({ id: t.filingSnapshots.id, contentHash: t.filingSnapshots.contentHash }).from(t.filingSnapshots).where(eq(t.filingSnapshots.workspaceId, ctx.workspace.id)),
    ctx.db.select().from(t.clientApprovals).where(eq(t.clientApprovals.workspaceId, ctx.workspace.id)).orderBy(asc(t.clientApprovals.createdRevision)),
    ctx.db.select().from(t.submissions).where(eq(t.submissions.workspaceId, ctx.workspace.id)).orderBy(asc(t.submissions.createdRevision), desc(t.submissions.jurisdiction)),
  ]);
  const hashOf = new Map(allSnapshots.map((s) => [s.id, s.contentHash]));
  const changes = await presentedChanges(ctx.db, packet, ctx.workspace.id, payload, redact);

  const formsInOrder: string[] = [];
  const byForm = new Map<string, ClientCopyRecord["forms"][number]>();
  for (const l of payload.lines) {
    let group = byForm.get(l.form);
    if (!group) {
      group = { form: l.form, jurisdiction: l.jurisdiction, lines: [] };
      byForm.set(l.form, group);
      formsInOrder.push(l.form);
    }
    group.lines.push({ key: l.key, line: l.line, label: redact.text(l.label), baseline: redact.deep(l.baseline), effective: redact.deep(l.effective), status: l.status });
  }
  const people = packet.household.people
    .filter((p) => p.role === "taxpayer" || p.role === "spouse" || p.role === "dependent")
    .map((p) => ({ role: p.role, name: redact.text(p.name), ssnMasked: (redact.deep({ ssn: p.ssn }) as { ssn: string }).ssn }));
  const identificationNote = "Social Security numbers are shown as the last four digits only; the full numbers are never written into this copy.";
  const approvals = approvalsRows
    .filter((a) => a.presentationHash === snap.contentHash)
    .map((a) => ({
      personName: personName(packet, a.personId),
      signedAt: iso(a.signedAt),
      presentationHash: a.presentationHash,
      status: a.status,
      simulated: a.simulatedSignature,
      invalidationReason: a.invalidationReason === null ? null : redact.text(a.invalidationReason),
    }));
  const submissions = submissionRows
    .filter((s) => hashOf.get(s.snapshotId) === snap.contentHash)
    .map((s) => ({
      jurisdiction: s.jurisdiction,
      attempt: s.attempt,
      status: s.status,
      submissionRef: s.submissionRef,
      simulated: s.simulated,
      submittedAt: iso(s.submittedAt),
      decidedAt: isoOrNull(s.decidedAt),
      errors: s.errors.map((e) => ({ code: e.code, message: redact.text(e.message) })),
    }));
  const generatedAt = new Date().toISOString();
  const body: Omit<ClientCopyRecord, "manifest"> = {
    identification: { taxYear: packet.household.tax_year, filingStatus: packet.household.filing_status.replace(/_/g, " "), people },
    baseline: (redact.deep(payload.baselineSummary) as ClientCopyRecord["baseline"]) ?? { federal: {}, california: {} },
    forms: formsInOrder.map((f) => byForm.get(f)!),
    changes,
    effects: {
      federal: payload.estimatedEffects.federal,
      california: payload.estimatedEffects.california,
      balanceFederal: payload.estimatedEffects.balanceFederal,
      balanceCalifornia: payload.estimatedEffects.balanceCalifornia,
    },
    limitations: payload.estimatedEffects.limitations.map((l) => redact.text(l)),
    presentationNote: redact.text(payload.presentationNote),
    approvals,
    submissions,
  };
  const manifest: ClientCopyRecord["manifest"] = {
    documentKind: "client_copy",
    workspaceId: ctx.workspace.id,
    snapshotId: snap.id,
    snapshotKind: snap.kind,
    revision: snap.revision,
    contentHash: snap.contentHash,
    businessTime: iso(snap.businessTime),
    generatedAt,
    version: payload.version,
    standardsVersion: payload.standardsVersion,
    identificationNote,
    recordSha256: sha256(JSON.stringify(body)),
  };
  const record: ClientCopyRecord = { manifest, ...body };
  const html = renderClientCopyHtml(record);
  return {
    snapshotId: snap.id,
    kind: snap.kind,
    filename: `trace-client-copy-${snap.id}`,
    html,
    json: { ...record, payload: redact.deep(payload) },
  };
}

function renderClientCopyHtml(r: ClientCopyRecord): string {
  const fed = r.baseline.federal ?? {};
  const ca = r.baseline.california ?? {};
  const kindWords = r.manifest.snapshotKind === "accepted" ? "accepted return" : r.manifest.snapshotKind === "submission" ? "submitted return" : "return presented for approval";
  const parts: string[] = [];
  parts.push(`<h1>Client copy: ${esc(String(r.identification.taxYear))} income tax return (${esc(kindWords)})</h1>`);
  parts.push(`<p class="muted small">Frozen presentation ${esc(r.manifest.contentHash.slice(0, 16))}, revision ${esc(String(r.manifest.revision))}, business time ${esc(dateTime(r.manifest.businessTime))}. Generated ${esc(dateTime(r.manifest.generatedAt))}. This document is self-contained; nothing in it links back to the workpaper.</p>`);

  parts.push(`<h2>Identification</h2>`);
  parts.push(`<p>Tax year <span class="num">${esc(String(r.identification.taxYear))}</span>, filing status ${esc(r.identification.filingStatus)}.</p>`);
  parts.push(`<table><thead><tr><th>Role</th><th>Name</th><th>SSN (last four)</th></tr></thead><tbody>${r.identification.people
    .map((p) => `<tr><td>${esc(p.role)}</td><td>${esc(p.name)}</td><td class="num">${esc(p.ssnMasked)}</td></tr>`)
    .join("")}</tbody></table>`);
  parts.push(`<p class="small muted">${esc(r.manifest.identificationNote)}</p>`);

  parts.push(`<h2>Engine baseline totals (as computed, version ${esc(r.manifest.version)})</h2>`);
  parts.push(`<table><thead><tr><th>Federal</th><th>Amount</th><th>California</th><th>Amount</th></tr></thead><tbody>
<tr><td>Adjusted gross income</td><td>${cell(fed.agi)}</td><td>Total AGI</td><td>${cell(ca.total_agi)}</td></tr>
<tr><td>Taxable income</td><td>${cell(fed.taxable_income)}</td><td>California AGI</td><td>${cell(ca.ca_agi)}</td></tr>
<tr><td>Total tax</td><td>${cell(fed.total_tax)}</td><td>Total tax</td><td>${cell(ca.total_tax)}</td></tr>
<tr><td>Payments</td><td>${cell(fed.payments)}</td><td>Payments</td><td>${cell(ca.payments)}</td></tr>
<tr><td>Balance due (negative is an overpayment)</td><td>${cell(fed.balance_due)}</td><td>Balance due (negative is an overpayment)</td><td>${cell(ca.balance_due)}</td></tr>
<tr><td>Penalty</td><td>${cell(fed.penalty)}</td><td>Penalty</td><td>${cell(ca.penalty)}</td></tr>
</tbody></table>`);
  parts.push(`<p class="small">${esc(r.presentationNote)}</p>`);

  parts.push(`<h2>Changes the firm made after the engine computed the return</h2>`);
  if (r.changes.length === 0) parts.push(`<p>No changes were accepted; every line carries the engine's value.</p>`);
  else {
    parts.push(`<table><thead><tr><th>Line</th><th>Change</th><th>Reason and evidence</th><th>Estimated effect</th></tr></thead><tbody>${r.changes
      .map(
        (c) => `<tr><td><span class="num">${esc(c.line)}</span><br><span class="small">${esc(c.lineLabel)}</span></td>
<td>${c.kind === "label" ? `${esc(c.fromLabel ?? "blank")} to <strong>${esc(c.toLabel ?? "blank")}</strong>` : c.kind === "value" ? `${cell(c.from)} to <strong>${cell(c.to)}</strong>` : "evidence links only; value unchanged"}</td>
<td>${esc(c.reason)}${c.evidence.length ? `<ul class="small">${c.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}</td>
<td class="small">federal tax ${signedCell(c.effectFederal)}<br>California tax ${signedCell(c.effectCalifornia)}<br><span class="muted">${esc(c.effectStatus.replace(/_/g, " "))}</span>${c.limitations.length ? `<br><span class="muted">${esc(c.limitations.join(" "))}</span>` : ""}</td></tr>`,
      )
      .join("")}</tbody></table>`);
  }
  parts.push(`<h3>Estimated effect of all accepted changes</h3>`);
  parts.push(`<table><tbody>
<tr><td>Federal tax</td><td>${signedCell(r.effects.federal)}</td><td>Federal balance due</td><td>${signedCell(r.effects.balanceFederal)}</td></tr>
<tr><td>California tax</td><td>${signedCell(r.effects.california)}</td><td>California balance due</td><td>${signedCell(r.effects.balanceCalifornia)}</td></tr>
</tbody></table>`);
  parts.push(`<p class="small">These are estimates at the engine version's supplied per-dollar rates, summed over accepted changes. The engine was not rerun, so no recomputed final tax is claimed.</p>`);
  if (r.limitations.length) parts.push(`<h3>Limitations</h3><ul class="small">${r.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);

  parts.push(`<h2>Every return line, by form</h2>`);
  for (const f of r.forms) {
    parts.push(`<h3>${esc(f.form)} <span class="badge">${esc(f.jurisdiction)}</span> <span class="muted small">${esc(String(f.lines.length))} lines</span></h3>`);
    parts.push(`<table><thead><tr><th>Line</th><th>Label</th><th>Engine baseline</th><th>Effective</th><th>Status</th></tr></thead><tbody>${f.lines
      .map((l) => `<tr><td class="num">${esc(l.line)}</td><td>${esc(l.label)}</td><td>${cell(l.baseline)}</td><td>${cell(l.effective)}</td><td class="small">${esc(STATUS_WORDS[l.status] ?? l.status)}</td></tr>`)
      .join("")}</tbody></table>`);
  }

  parts.push(`<h2>Approvals (simulated e-file authorization)</h2>`);
  if (r.approvals.length === 0) parts.push(`<p>No approval is bound to this presentation.</p>`);
  else {
    parts.push(`<table><thead><tr><th>Person</th><th>Signed at (business time)</th><th>Presentation hash</th><th>Status</th></tr></thead><tbody>${r.approvals
      .map((a) => `<tr><td>${esc(a.personName)}</td><td class="num">${esc(dateTime(a.signedAt))}</td><td class="num">${esc(a.presentationHash.slice(0, 16))}</td><td>${esc(a.status)}${a.simulated ? " (simulated signature)" : ""}${a.invalidationReason ? `<br><span class="small muted">${esc(a.invalidationReason)}</span>` : ""}</td></tr>`)
      .join("")}</tbody></table>`);
  }

  parts.push(`<h2>Submissions (simulated transmission)</h2>`);
  if (r.submissions.length === 0) parts.push(`<p>This presentation has not been submitted.</p>`);
  else {
    parts.push(`<table><thead><tr><th>Jurisdiction</th><th>Attempt</th><th>Status</th><th>Simulated submission ref</th><th>Submitted</th><th>Decided</th><th>Errors</th></tr></thead><tbody>${r.submissions
      .map(
        (s) => `<tr><td>${esc(s.jurisdiction)}</td><td class="num">${esc(String(s.attempt))}</td><td>${esc(s.status.replace(/_/g, " "))}${s.simulated ? " (simulated)" : ""}</td><td class="num">${esc(s.submissionRef)}</td><td class="num">${esc(dateTime(s.submittedAt))}</td><td class="num">${esc(s.decidedAt ? dateTime(s.decidedAt) : "")}</td><td class="small">${s.errors.map((e) => `${esc(e.code)}: ${esc(e.message)}`).join("<br>")}</td></tr>`,
      )
      .join("")}</tbody></table>`);
  }

  parts.push(`<h2>Manifest</h2>`);
  parts.push(
    manifestBlock([
      ["Snapshot id", r.manifest.snapshotId],
      ["Kind", r.manifest.snapshotKind],
      ["Revision", String(r.manifest.revision)],
      ["Content hash (SHA-256)", r.manifest.contentHash],
      ["Business time", r.manifest.businessTime],
      ["Generated at", r.manifest.generatedAt],
      ["Engine version", r.manifest.version],
      ["Firm standard", r.manifest.standardsVersion],
      ["Workspace", r.manifest.workspaceId],
      ["Record SHA-256", r.manifest.recordSha256],
    ]),
  );
  return htmlDocument(`Client copy ${r.manifest.snapshotId}`, parts.join("\n"));
}

/* ------------------------------------------------------------------------ */
/* Notice bundle                                                              */
/* ------------------------------------------------------------------------ */

export interface BundlePassage {
  id: string;
  ref: string;
  documentId: string;
  documentTitle: string;
  page: number | null;
  receivedAt: string | null;
  text: string;
  sha256: string;
}

export interface BundleSource {
  ref: string;
  label: string;
  kind: string;
  found: boolean;
  /** What the pipeline read, for an extracted value. */
  valueText: string | null;
  passageIds: string[];
}

export interface BundleAdjustment {
  id: string;
  kind: string;
  priorValue: unknown;
  proposedValue: unknown;
  proposedLabel: string | null;
  reason: string;
  evidence: string[];
  effectFederal: number | null;
  effectCalifornia: number | null;
  effectStatus: string;
  limitations: string[];
  decidedByName: string;
  decidedAt: string | null;
}

export interface BundleJudgment {
  id: string;
  kind: string;
  title: string;
  authority: string;
  applicability: string;
  conclusion: string;
  consequences: string | null;
  evidence: string[];
  decidedByName: string;
}

export interface BundleAttachment {
  id: string;
  kind: string;
  filename: string;
  contentType: string;
  byteLength: number;
  sha256: string;
  encoding: string;
  /** Text content inline (redacted) for utf8, base64 for files. */
  content: string;
  uploadedByName: string;
  businessTime: string;
  linkedTo: string[];
}

export interface BundleLine {
  key: string;
  form: string;
  line: string;
  label: string;
  jurisdiction: string;
  value: { basis: "accepted_snapshot" | "current_effective"; baseline: unknown; effective: unknown; status: string };
  rule: { id: string; description: string };
  sources: BundleSource[];
  adjustments: BundleAdjustment[];
  judgments: BundleJudgment[];
  attachments: BundleAttachment[];
}

export interface NoticeBundleRecord {
  manifest: {
    documentKind: "notice_bundle";
    noticeId: string;
    workspaceId: string;
    asOf: string;
    generatedAt: string;
    version: string;
    valueBasis: "accepted_snapshot" | "current_effective";
    acceptedSnapshot: { id: string; contentHash: string; revision: number; businessTime: string } | null;
    warning: string | null;
    items: { item: string; lines: string[] }[];
    passages: { id: string; documentId: string; page: number | null; sha256: string }[];
    attachments: { id: string; sha256: string }[];
    adjustments: string[];
    judgments: string[];
    recordSha256: string;
  };
  notice: {
    id: string;
    agency: string;
    type: string;
    taxYear: number | null;
    dated: string;
    responseDue: string | null;
    summary: string | null;
    status: string | null;
    items: string[];
    documentId: string | null;
    documentTitle: string | null;
    documentPassageIds: string[];
  };
  items: { item: string; lines: BundleLine[] }[];
  passages: BundlePassage[];
}

export interface NoticeBundle {
  noticeId: string;
  filename: string;
  html: string;
  json: NoticeBundleRecord;
}

/** Map an examination item to return line keys in the version. */
export function examinationLines(item: string, version: ReturnVersion): string[] {
  const keys = new Set(version.lines.map((l) => l.key));
  const out: string[] = [];
  const text = item.toLowerCase();
  if (/non-?cash|8283|schedule a line 12/.test(text)) {
    for (const l of version.lines) if (l.form === "F8283") out.push(l.key);
    if (keys.has("SchA.12")) out.push("SchA.12");
  }
  if (/schedule c/.test(text) && /gross receipts|1099-nec|1099-k/.test(text)) {
    if (keys.has("SchC.1")) out.push("SchC.1");
  }
  // Any line key quoted literally in the item text.
  for (const m of item.matchAll(/\b([A-Za-z][A-Za-z0-9]*(?:-[A-Z])?\.[A-Za-z0-9.]+)\b/g)) {
    if (keys.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return [...new Set(out)];
}

class PassageStore {
  private readonly map = new Map<string, BundlePassage>();
  constructor(
    private readonly packet: Packet,
    private readonly redact: Redactor,
    private readonly clockMs: number,
  ) {}

  private add(id: string, ref: string, documentId: string, documentTitle: string, page: number | null, receivedAt: string | null, text: string): string {
    if (!this.map.has(id)) {
      const clean = this.redact.text(text);
      this.map.set(id, { id, ref, documentId, documentTitle: this.redact.text(documentTitle), page, receivedAt, text: clean, sha256: sha256(clean) });
    }
    return id;
  }

  /** Passage ids for a reference: document pages, or the client's own words for answers, messages and calls. */
  forRef(ref: string): string[] {
    const idx = indexPacket(this.packet);
    const parsed = parseRef(ref);
    const pages = (docId: string, only?: number): string[] => {
      const doc = idx.documents.get(docId);
      if (!doc) return [];
      if (new Date(doc.received_at).getTime() > this.clockMs) return [];
      return doc.pages
        .filter((p) => only === undefined || p.page === only)
        .map((p) => this.add(`${doc.id}-p${p.page}`, `doc:${doc.id}#page${p.page}`, doc.id, doc.title, p.page, doc.received_at, p.printed_content));
    };
    switch (parsed.kind) {
      case "document":
        return pages(parsed.id);
      case "document_page":
        return pages(parsed.documentId, parsed.page);
      case "extracted_value": {
        const ev = idx.extractedValues.get(parsed.id);
        return ev ? pages(ev.document_id, ev.page) : [];
      }
      case "questionnaire": {
        const q = idx.questionnaire.get(parsed.id);
        return q ? [this.add(parsed.id, ref, parsed.id, `Questionnaire answer ${parsed.id}`, null, q.answered_at, `Question: ${q.question}\nAnswer (${q.answered_by}, ${q.answered_at.slice(0, 10)}): ${q.answer}`)] : [];
      }
      case "message": {
        const m = idx.messages.get(parsed.id);
        return m ? [this.add(parsed.id, ref, parsed.id, `Message ${parsed.id}`, null, m.sent_at, `From ${m.from} to ${m.to} on ${m.sent_at}:\n${m.text}`)] : [];
      }
      case "call_note": {
        const c = idx.callNotes.get(parsed.id);
        return c ? [this.add(parsed.id, ref, parsed.id, `Call note ${parsed.id}`, null, c.date, `Call on ${c.date} with ${c.participants.join(", ")}:\n${c.notes.join("\n")}`)] : [];
      }
      default:
        return [];
    }
  }

  all(): BundlePassage[] {
    return [...this.map.values()];
  }
}

export async function buildNoticeBundle(ctx: SessionContext, noticeId: string): Promise<NoticeBundle> {
  if (ctx.actor.role === "client") throw new ExportError("forbidden", "Notice bundles are prepared by the firm.");
  const packet = ctx.packet.packet;
  const redact = makeRedactor(packet);
  const notice = packetNotices(packet).find((n) => n.id === noticeId);
  if (!notice) throw new ExportError("not_found", `No notice ${noticeId} in the packet's agency records.`);
  const asOf = iso(ctx.workspace.asOf);
  const clockMs = new Date(asOf).getTime();
  const at = noticeAvailableAt(notice);
  if (at && new Date(at).getTime() > clockMs) {
    throw new ExportError("unavailable", `Notice ${noticeId} is dated ${notice.dated}; the replay clock is at ${asOf.slice(0, 10)}. Advance the clock to prepare the response.`);
  }
  const idx = indexPacket(packet);
  const state = await loadWorkspaceState(ctx.db, ctx);
  const version = state.version;
  const wsId = ctx.workspace.id;
  const [acceptedRows, attachmentRows] = await Promise.all([
    ctx.db
      .select()
      .from(t.filingSnapshots)
      .where(and(eq(t.filingSnapshots.workspaceId, wsId), eq(t.filingSnapshots.kind, "accepted")))
      .orderBy(asc(t.filingSnapshots.revision)),
    ctx.db.select().from(t.attachments).where(eq(t.attachments.workspaceId, wsId)).orderBy(asc(t.attachments.createdRevision)),
  ]);
  const accepted = acceptedRows[acceptedRows.length - 1];
  const acceptedPayload = accepted ? (accepted.payload as SnapshotPayload) : null;
  const frozenLines = acceptedPayload ? new Map(acceptedPayload.lines.map((l) => [l.key, l])) : null;
  const acceptedAdjustmentIds = acceptedPayload ? new Set((acceptedPayload.acceptedAdjustments as { id: string }[]).map((a) => a.id)) : null;
  const valueBasis: NoticeBundleRecord["manifest"]["valueBasis"] = accepted ? "accepted_snapshot" : "current_effective";
  const warning = accepted
    ? null
    : "No accepted filing exists in this workspace. The values below are the current effective workpaper values, not a filed return. Do not send them to the agency as the filed figures.";
  const store = new PassageStore(packet, redact, clockMs);
  const rules = packet.engine_reference.rules;
  const items: NoticeBundleRecord["items"] = [];
  const includedAdjustments = new Set<string>();
  const includedJudgments = new Set<string>();
  const includedAttachments = new Map<string, BundleAttachment>();

  const attachmentView = (a: (typeof attachmentRows)[number], linkedTo: string[]): BundleAttachment => ({
    id: a.id,
    kind: a.kind,
    filename: redact.text(a.filename),
    contentType: a.contentType,
    byteLength: a.byteLength,
    sha256: a.sha256,
    encoding: a.encoding,
    content: a.encoding === "base64" ? a.content : redact.text(a.content),
    uploadedByName: personName(packet, a.uploadedBy),
    businessTime: iso(a.businessTime),
    linkedTo,
  });

  for (const itemText of notice.items_under_examination ?? []) {
    const keys = examinationLines(itemText, version);
    const lines: BundleLine[] = [];
    for (const key of keys) {
      const line = idx.linesByVersion.get(version.version)!.get(key);
      if (!line) continue;
      const frozen = frozenLines?.get(key);
      const eff = state.effective.lines.get(key)!;
      const value: BundleLine["value"] = frozen
        ? { basis: "accepted_snapshot", baseline: redact.deep(frozen.baseline), effective: redact.deep(frozen.effective), status: frozen.status }
        : { basis: "current_effective", baseline: redact.deep(eff.baseline), effective: redact.deep(eff.effective), status: eff.status };
      // Sources: the engine's cited sources plus, for arithmetic lines, their input lines' sources.
      const sourceRefs = [...line.sources];
      for (const input of line.inputs) {
        const inLine = idx.linesByVersion.get(version.version)!.get(input);
        if (inLine) for (const s of inLine.sources) if (!sourceRefs.includes(s)) sourceRefs.push(s);
      }
      const sources = sourceRefs.map<BundleSource>((ref) => {
        const r = resolveRef(packet, ref, { version: version.version });
        const ev = r.parsed.kind === "extracted_value" ? idx.extractedValues.get(r.parsed.id) : undefined;
        return {
          ref,
          label: redact.text(r.label),
          kind: r.parsed.kind,
          found: r.found,
          valueText: ev ? redact.text(`${ev.label}: ${ev.text_as_read}`) : null,
          passageIds: store.forRef(ref),
        };
      });
      // Accepted adjustments on the line: those in the accepted filing when one exists, else all currently accepted.
      const adjRows = state.adjustments.filter((a) => a.targetRef === key && a.status === "accepted" && (acceptedAdjustmentIds ? acceptedAdjustmentIds.has(a.id) : true));
      const adjustments: BundleAdjustment[] = [];
      for (const a of adjRows) {
        includedAdjustments.add(a.id);
        const evidence = await evidenceTexts(ctx.db, packet, wsId, a.baselineVersion, a.evidenceRefs, redact);
        for (const ref of a.evidenceRefs) store.forRef(ref);
        adjustments.push({
          id: a.id,
          kind: a.kind,
          priorValue: redact.deep(a.priorValue),
          proposedValue: redact.deep(a.proposedValue),
          proposedLabel: a.proposedLabel === null ? null : redact.text(a.proposedLabel),
          reason: redact.text(a.reason),
          evidence: evidence.map((e) => e.text),
          effectFederal: numOrNull(a.effectFederal),
          effectCalifornia: numOrNull(a.effectCalifornia),
          effectStatus: a.effectStatus,
          limitations: a.limitations.map((l) => redact.text(l)),
          decidedByName: personName(packet, a.decidedBy),
          decidedAt: isoOrNull(a.decidedAt),
        });
      }
      const judgRows = state.judgments.filter((j) => j.status === "recorded" && (j.subjectRef === key || j.evidenceRefs.includes(key)));
      const judgments: BundleJudgment[] = [];
      for (const j of judgRows) {
        includedJudgments.add(j.id);
        const evidence = await evidenceTexts(ctx.db, packet, wsId, version.version, j.evidenceRefs, redact);
        for (const ref of j.evidenceRefs) store.forRef(ref);
        judgments.push({
          id: j.id,
          kind: j.kind,
          title: redact.text(j.title),
          authority: redact.text(j.authority),
          applicability: redact.text(j.applicability),
          conclusion: redact.text(j.conclusion),
          consequences: j.consequences === null ? null : redact.text(j.consequences),
          evidence: evidence.map((e) => e.text),
          decidedByName: personName(packet, j.decidedBy),
        });
      }
      // Attachments linked to the line, to its adjustments or judgments, or cited by them as evidence.
      const targets = new Set<string>([key, ...adjRows.map((a) => `adjustment:${a.id}`), ...judgRows.map((j) => `judgment:${j.id}`)]);
      const cited = new Set<string>([...adjRows.flatMap((a) => a.evidenceRefs), ...judgRows.flatMap((j) => j.evidenceRefs)]);
      const attachments: BundleAttachment[] = [];
      for (const a of attachmentRows) {
        const linked = a.linkedRefs.filter((r) => targets.has(r));
        const isCited = cited.has(`attachment:${a.id}`);
        if (linked.length === 0 && !isCited) continue;
        const view = attachmentView(a, [...linked, ...(isCited ? ["cited as evidence"] : [])]);
        includedAttachments.set(a.id, view);
        attachments.push(view);
      }
      lines.push({
        key,
        form: line.form,
        line: line.line,
        label: redact.text(line.label),
        jurisdiction: line.jurisdiction,
        value,
        rule: { id: line.rule, description: redact.text(rules[line.rule] ?? "No description supplied in the engine reference.") },
        sources,
        adjustments,
        judgments,
        attachments,
      });
    }
    items.push({ item: redact.text(itemText), lines });
  }

  const doc = notice.document ? idx.documents.get(notice.document) : undefined;
  const documentPassageIds = notice.document ? store.forRef(notice.document) : [];
  const passages = store.all();
  const generatedAt = new Date().toISOString();
  const body: Omit<NoticeBundleRecord, "manifest"> = {
    notice: {
      id: notice.id,
      agency: redact.text(String(notice.agency ?? "")),
      type: redact.text(String(notice.type ?? "")),
      taxYear: typeof notice.tax_year === "number" ? notice.tax_year : null,
      dated: String(notice.dated ?? ""),
      responseDue: notice.response_due ?? null,
      summary: notice.summary ? redact.text(notice.summary) : null,
      status: notice.status ? redact.text(notice.status) : null,
      items: (notice.items_under_examination ?? []).map((i) => redact.text(i)),
      documentId: notice.document ?? null,
      documentTitle: doc ? redact.text(doc.title) : null,
      documentPassageIds,
    },
    items,
    passages,
  };
  const manifest: NoticeBundleRecord["manifest"] = {
    documentKind: "notice_bundle",
    noticeId: notice.id,
    workspaceId: wsId,
    asOf,
    generatedAt,
    version: version.version,
    valueBasis,
    acceptedSnapshot: accepted ? { id: accepted.id, contentHash: accepted.contentHash, revision: accepted.revision, businessTime: iso(accepted.businessTime) } : null,
    warning,
    items: items.map((i) => ({ item: i.item, lines: i.lines.map((l) => l.key) })),
    passages: passages.map((p) => ({ id: p.id, documentId: p.documentId, page: p.page, sha256: p.sha256 })),
    attachments: [...includedAttachments.values()].map((a) => ({ id: a.id, sha256: a.sha256 })),
    adjustments: [...includedAdjustments],
    judgments: [...includedJudgments],
    recordSha256: sha256(JSON.stringify(body)),
  };
  const record: NoticeBundleRecord = { manifest, ...body };
  return { noticeId: notice.id, filename: `trace-notice-${notice.id}`, html: renderNoticeBundleHtml(record), json: record };
}

function renderNoticeBundleHtml(r: NoticeBundleRecord): string {
  const parts: string[] = [];
  const n = r.notice;
  parts.push(`<h1>Notice response bundle: ${esc(n.agency)} ${esc(n.type)}, ${esc(n.id)}</h1>`);
  parts.push(`<p class="muted small">Prepared at replay time ${esc(dateTime(r.manifest.asOf))}, generated ${esc(dateTime(r.manifest.generatedAt))}. Self-contained: every passage is printed in full below with its SHA-256; nothing links back to the workpaper.</p>`);
  if (r.manifest.warning) parts.push(`<div class="warn"><strong>Warning.</strong> ${esc(r.manifest.warning)}</div>`);
  else if (r.manifest.acceptedSnapshot)
    parts.push(`<p>Values are the frozen values of the accepted filing (snapshot ${esc(r.manifest.acceptedSnapshot.id)}, content hash <span class="num">${esc(r.manifest.acceptedSnapshot.contentHash)}</span>, accepted at business time ${esc(dateTime(r.manifest.acceptedSnapshot.businessTime))}).</p>`);

  parts.push(`<h2>The notice</h2>`);
  parts.push(`<table><tbody>
<tr><th>Agency</th><td>${esc(n.agency)}</td></tr>
<tr><th>Type</th><td>${esc(n.type)}</td></tr>
<tr><th>Tax year</th><td class="num">${esc(n.taxYear === null ? "" : String(n.taxYear))}</td></tr>
<tr><th>Dated</th><td class="num">${esc(n.dated)}</td></tr>
<tr><th>Response due</th><td class="num">${esc(n.responseDue ?? "")}</td></tr>
${n.summary ? `<tr><th>Summary</th><td>${esc(n.summary)}</td></tr>` : ""}
${n.status ? `<tr><th>Status</th><td>${esc(n.status)}</td></tr>` : ""}
<tr><th>Document</th><td>${esc(n.documentId ?? "")} ${esc(n.documentTitle ?? "")}</td></tr>
</tbody></table>`);
  if (n.items.length) parts.push(`<h3>Items under examination</h3><ol>${n.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`);
  if (n.documentPassageIds.length) parts.push(`<p class="small">Notice text: ${n.documentPassageIds.map((id) => `<a href="#passage-${esc(id)}">${esc(id)}</a>`).join(", ")} (printed in the passages section).</p>`);

  for (const item of r.items) {
    parts.push(`<h2>Item: ${esc(item.item)}</h2>`);
    if (item.lines.length === 0) parts.push(`<p class="muted">No return line could be mapped to this item.</p>`);
    for (const l of item.lines) {
      parts.push(`<h3><span class="num">${esc(l.key)}</span> ${esc(l.form)} line ${esc(l.line)}: ${esc(l.label)} <span class="badge">${esc(l.jurisdiction)}</span></h3>`);
      parts.push(`<table><tbody>
<tr><th>Value basis</th><td>${l.value.basis === "accepted_snapshot" ? "frozen value from the accepted filing" : "<strong>current effective workpaper value (no accepted filing exists)</strong>"}</td></tr>
<tr><th>Engine baseline</th><td>${cell(l.value.baseline)}</td></tr>
<tr><th>Effective value</th><td>${cell(l.value.effective)} <span class="muted small">${esc(STATUS_WORDS[l.value.status] ?? l.value.status)}</span></td></tr>
<tr><th>Engine rule</th><td><span class="num">${esc(l.rule.id)}</span>: ${esc(l.rule.description)}</td></tr>
</tbody></table>`);
      parts.push(`<h3>Sources</h3>`);
      if (l.sources.length === 0) parts.push(`<p class="muted small">The engine cites no direct source for this line; see its input lines.</p>`);
      else
        parts.push(`<table><thead><tr><th>Reference</th><th>What it is</th><th>As read</th><th>Printed passage</th></tr></thead><tbody>${l.sources
          .map(
            (s) => `<tr><td class="num">${esc(s.ref)}</td><td>${esc(s.label)}${s.found ? "" : ' <span class="badge">not in packet</span>'}</td><td class="small">${esc(s.valueText ?? "")}</td><td class="small">${s.passageIds.length ? s.passageIds.map((id) => `<a href="#passage-${esc(id)}">${esc(id)}</a>`).join(", ") : '<span class="muted">none available</span>'}</td></tr>`,
          )
          .join("")}</tbody></table>`);
      parts.push(`<h3>Accepted adjustments on this line</h3>`);
      if (l.adjustments.length === 0) parts.push(`<p class="muted small">None; the filed value is the engine's value.</p>`);
      else
        parts.push(`<table><thead><tr><th>Adjustment</th><th>Change</th><th>Reason and evidence</th><th>Decided</th></tr></thead><tbody>${l.adjustments
          .map(
            (a) => `<tr><td class="num">${esc(a.id)}</td><td>${a.kind === "label" ? `label to <strong>${esc(a.proposedLabel ?? "blank")}</strong>` : a.kind === "value" ? `${cell(a.priorValue)} to <strong>${cell(a.proposedValue)}</strong>` : "evidence links only"}</td><td>${esc(a.reason)}${a.evidence.length ? `<ul class="small">${a.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}<div class="small muted">federal tax ${signedCell(a.effectFederal)}, California tax ${signedCell(a.effectCalifornia)}, ${esc(a.effectStatus.replace(/_/g, " "))}${a.limitations.length ? `. ${esc(a.limitations.join(" "))}` : ""}</div></td><td class="small">${esc(a.decidedByName)}<br><span class="num">${esc(a.decidedAt ? dateTime(a.decidedAt) : "")}</span></td></tr>`,
          )
          .join("")}</tbody></table>`);
      parts.push(`<h3>Judgments touching this line</h3>`);
      if (l.judgments.length === 0) parts.push(`<p class="muted small">None recorded.</p>`);
      else
        parts.push(`<table><thead><tr><th>Judgment</th><th>Authority</th><th>Applicability and conclusion</th><th>Evidence</th></tr></thead><tbody>${l.judgments
          .map(
            (j) => `<tr><td><strong>${esc(j.title)}</strong><br><span class="small muted">${esc(j.kind.replace(/_/g, " "))}, ${esc(j.decidedByName)}, <span class="num">${esc(j.id)}</span></span></td><td class="small">${esc(j.authority)}</td><td class="small">${esc(j.applicability)}<br><strong>${esc(j.conclusion)}</strong>${j.consequences ? `<br>${esc(j.consequences)}` : ""}</td><td class="small">${j.evidence.map((e) => esc(e)).join("<br>")}</td></tr>`,
          )
          .join("")}</tbody></table>`);
      parts.push(`<h3>Attachments</h3>`);
      if (l.attachments.length === 0) parts.push(`<p class="muted small">None linked.</p>`);
      else
        for (const a of l.attachments) {
          parts.push(`<p><strong>${esc(a.filename)}</strong> (${esc(a.kind)}, ${esc(a.contentType)}, <span class="num">${esc(String(a.byteLength))}</span> bytes, SHA-256 <span class="num">${esc(a.sha256)}</span>) from ${esc(a.uploadedByName)} at <span class="num">${esc(dateTime(a.businessTime))}</span>; linked to ${esc(a.linkedTo.join(", "))}.</p>`);
          parts.push(
            a.encoding === "base64"
              ? `<p class="small muted">Binary content, base64:</p><pre class="passage">${esc(a.content)}</pre>`
              : `<pre class="passage">${esc(a.content)}</pre>`,
          );
        }
    }
  }

  parts.push(`<h2>Printed passages</h2>`);
  if (r.passages.length === 0) parts.push(`<p class="muted">No passages were cited.</p>`);
  for (const p of r.passages) {
    parts.push(`<h3 id="passage-${esc(p.id)}">${esc(p.id)}: ${esc(p.documentTitle)}${p.page === null ? "" : `, page ${esc(String(p.page))}`}</h3>`);
    parts.push(`<p class="small muted">Reference <span class="num">${esc(p.ref)}</span>${p.receivedAt ? `, received ${esc(dateTime(p.receivedAt))}` : ""}. SHA-256 of the passage text <span class="num">${esc(p.sha256)}</span>.</p>`);
    parts.push(`<pre class="passage">${esc(p.text)}</pre>`);
  }

  parts.push(`<h2>Manifest</h2>`);
  parts.push(
    manifestBlock([
      ["Notice", r.manifest.noticeId],
      ["Workspace", r.manifest.workspaceId],
      ["Replay time", r.manifest.asOf],
      ["Generated at", r.manifest.generatedAt],
      ["Engine version", r.manifest.version],
      ["Value basis", r.manifest.valueBasis],
      ["Accepted snapshot", r.manifest.acceptedSnapshot ? `${r.manifest.acceptedSnapshot.id} ${r.manifest.acceptedSnapshot.contentHash}` : "none"],
      ["Record SHA-256", r.manifest.recordSha256],
    ]),
  );
  parts.push(`<h3>Included items</h3><ul class="small">${r.manifest.items.map((i) => `<li>${esc(i.item)}: <span class="num">${esc(i.lines.join(", ") || "no lines")}</span></li>`).join("")}</ul>`);
  parts.push(`<h3>Passages</h3><ul class="small">${r.manifest.passages.map((p) => `<li><span class="num">${esc(p.id)}</span> ${esc(p.documentId)}${p.page === null ? "" : ` page ${esc(String(p.page))}`}: <span class="num">${esc(p.sha256)}</span></li>`).join("")}</ul>`);
  if (r.manifest.attachments.length) parts.push(`<h3>Attachments</h3><ul class="small">${r.manifest.attachments.map((a) => `<li><span class="num">${esc(a.id)}</span>: <span class="num">${esc(a.sha256)}</span></li>`).join("")}</ul>`);
  if (r.manifest.adjustments.length) parts.push(`<h3>Adjustments</h3><p class="small num">${esc(r.manifest.adjustments.join(", "))}</p>`);
  if (r.manifest.judgments.length) parts.push(`<h3>Judgments</h3><p class="small num">${esc(r.manifest.judgments.join(", "))}</p>`);
  return htmlDocument(`Notice bundle ${r.manifest.noticeId}`, parts.join("\n"));
}

/* ------------------------------------------------------------------------ */
/* Carryforward                                                               */
/* ------------------------------------------------------------------------ */

export async function carryforwardExport(ctx: SessionContext, snapshotId: string): Promise<{ filename: string; json: unknown }> {
  if (ctx.actor.role === "client") throw new ExportError("forbidden", "The carryforward record is firm-internal.");
  const snap = await snapshotForViewer(ctx, snapshotId);
  if (snap.kind !== "carryforward") throw new ExportError("not_found", "That snapshot is not a carryforward record.");
  const redact = makeRedactor(ctx.packet.packet);
  return {
    filename: `trace-carryforward-${snap.id}`,
    json: redact.deep({
      manifest: { documentKind: "carryforward", workspaceId: ctx.workspace.id, snapshotId: snap.id, revision: snap.revision, businessTime: iso(snap.businessTime), createdBy: snap.createdBy, generatedAt: new Date().toISOString() },
      ...(snap.payload as object),
    }),
  };
}

/* ------------------------------------------------------------------------ */
/* Attachments                                                                */
/* ------------------------------------------------------------------------ */

export interface AttachmentContent {
  id: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/** An attachment for the session's viewer. Clients get only their own uploads and the attachments of requests addressed to them. */
export async function attachmentForViewer(ctx: SessionContext, id: string): Promise<AttachmentContent> {
  const [row] = await ctx.db.select().from(t.attachments).where(and(eq(t.attachments.id, id), eq(t.attachments.workspaceId, ctx.workspace.id)));
  if (!row) throw new ExportError("not_found", "No such attachment in this workspace.");
  if (ctx.actor.role === "client" && row.uploadedBy !== ctx.actor.id) {
    let allowed = false;
    if (row.requestId) {
      const [req] = await ctx.db.select({ toActorId: t.requests.toActorId }).from(t.requests).where(and(eq(t.requests.id, row.requestId), eq(t.requests.workspaceId, ctx.workspace.id)));
      allowed = req?.toActorId === ctx.actor.id;
    }
    if (!allowed) throw new ExportError("forbidden", "This attachment is not part of your requests.");
  }
  const redact = makeRedactor(ctx.packet.packet);
  const bytes = row.encoding === "base64" ? Buffer.from(row.content, "base64") : Buffer.from(redact.text(row.content), "utf8");
  return { id: row.id, filename: redact.text(row.filename), contentType: row.contentType, bytes };
}
