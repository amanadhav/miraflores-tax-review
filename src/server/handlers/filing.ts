import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as t from "@/db/schema";
import { PolicyError, requirePermission } from "@/domain/policy";
import { indexPacket } from "@/packet/load";
import { CommandError, registerHandler, type AuditSeed, type HandlerContext } from "../commands";
import { filingReadiness, latestSnapshot } from "../filing";
import { buildSnapshotPayload } from "../presentation";
import { newId } from "../ids";
import { notify } from "../notify";
import { loadWorkspaceState } from "../state";
import { currentStandards } from "../standards";

export type WorkflowState = "preparing" | "ready_for_client" | "authorized" | "submitted" | "rejected" | "accepted" | "amending";

async function setState(hc: Pick<HandlerContext, "tx" | "ctx">, next: WorkflowState, summary: string): Promise<AuditSeed> {
  await hc.tx.update(t.workspaces).set({ workflowState: next }).where(eq(t.workspaces.id, hc.ctx.workspace.id));
  return {
    action: "workflow_state_changed",
    entityType: "workspace",
    entityId: hc.ctx.workspace.id,
    summary,
    before: { workflowState: hc.ctx.workspace.workflowState },
    after: { workflowState: next },
  };
}

/**
 * Present the return to the client. Every required step is re-evaluated
 * inside the command's transaction; the presentation is frozen as a hashed
 * snapshot that approvals bind to.
 */
registerHandler({
  type: "present_to_client",
  schema: z.object({ note: z.string().max(2000).optional() }),
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "sign_off_reviewer", "present the return to the client");
    if (!["preparing", "rejected"].includes(ctx.workspace.workflowState)) {
      throw new CommandError("invalid_state", `The return is ${ctx.workspace.workflowState.replace(/_/g, " ")}; it can be presented from preparing or rejected only.`);
    }
    const state = await loadWorkspaceState(tx, ctx);
    const readiness = await filingReadiness(tx, ctx, state);
    if (!readiness.ok) {
      throw new CommandError("invalid_state", `Not ready: ${readiness.blocking.map((b) => `${b.step} (${b.detail})`).join(" | ")}`);
    }
    const std = await currentStandards(tx, ctx.workspace.id, ctx.packet.packet.firm.starter_standards);
    const { payload, hash } = buildSnapshotPayload({ ...ctx, workspace: { ...ctx.workspace, revision } }, state, std.id);
    const id = newId("snp");
    await tx.insert(t.filingSnapshots).values({
      id,
      workspaceId: ctx.workspace.id,
      kind: "client_ready",
      revision,
      contentHash: hash,
      payload,
      createdBy: ctx.actor.id,
      businessTime: hc.businessTime,
    });
    const events: AuditSeed[] = [
      {
        action: "return_presented",
        entityType: "snapshot",
        entityId: id,
        summary: `${ctx.actor.name} presented the return to the client (frozen presentation ${hash.slice(0, 12)}, revision ${revision})${p.note ? `: ${p.note}` : "."}`,
        after: { snapshotId: id, contentHash: hash, estimatedEffects: payload.estimatedEffects },
      },
      await setState(hc, "ready_for_client", "Return is ready for client approval."),
    ];
    await notify(
      tx,
      ctx.workspace.id,
      revision,
      ctx.packet.packet.firm.client_users.map((c) => ({
        recipientId: c.id,
        kind: "approval_request",
        title: "Your 2025 return is ready to review and approve",
        body: "Please review the presented return and sign the e-file authorization (simulated).",
        refs: [`snapshot:${id}`],
      })),
    );
    return { result: { snapshotId: id, contentHash: hash }, events };
  },
});

/** A client approves and signs (simulated) the presentation they were shown. Both spouses must approve. */
registerHandler({
  type: "approve_return",
  schema: z.object({ snapshotId: z.string().min(1), acknowledgement: z.literal(true) }),
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    if (ctx.actor.role !== "client") throw new PolicyError("forbidden", "Only the client can approve their return.");
    if (ctx.workspace.workflowState !== "ready_for_client") throw new CommandError("invalid_state", "The return is not presented for approval right now.");
    const snap = await latestSnapshot(tx, ctx.workspace.id, "client_ready");
    if (!snap || snap.id !== p.snapshotId) throw new CommandError("invalid_state", "That presentation is no longer current. Review the latest one.");
    // The presentation must still match the workpaper exactly.
    const state = await loadWorkspaceState(tx, ctx);
    const std = await currentStandards(tx, ctx.workspace.id, ctx.packet.packet.firm.starter_standards);
    const { hash } = buildSnapshotPayload({ ...ctx, workspace: { ...ctx.workspace, revision: snap.revision } }, state, std.id);
    if (hash !== snap.contentHash) throw new CommandError("invalid_state", "The workpaper changed after this presentation was prepared; a new presentation is required.");
    const existing = await tx
      .select()
      .from(t.clientApprovals)
      .where(and(eq(t.clientApprovals.workspaceId, ctx.workspace.id), eq(t.clientApprovals.personId, ctx.actor.id), eq(t.clientApprovals.status, "approved")));
    if (existing.some((e) => e.presentationHash === hash)) throw new CommandError("invalid_state", "You already approved this presentation.");
    const id = newId("apr");
    await tx.insert(t.clientApprovals).values({
      id,
      workspaceId: ctx.workspace.id,
      personId: ctx.actor.id,
      snapshotId: snap.id,
      presentationHash: hash,
      status: "approved",
      simulatedSignature: true,
      signedAt: hc.businessTime,
      createdRevision: revision,
    });
    const approvals = await tx
      .select()
      .from(t.clientApprovals)
      .where(and(eq(t.clientApprovals.workspaceId, ctx.workspace.id), eq(t.clientApprovals.status, "approved"), eq(t.clientApprovals.presentationHash, hash)));
    const needed = ctx.packet.packet.firm.client_users.map((c) => c.id);
    const complete = needed.every((n) => approvals.some((a) => a.personId === n));
    const events: AuditSeed[] = [
      {
        action: "client_approved",
        entityType: "client_approval",
        entityId: id,
        summary: `${ctx.actor.name} approved the presented return and signed the e-file authorization (simulated signature bound to ${hash.slice(0, 12)}).`,
        after: { snapshotId: snap.id, presentationHash: hash, simulated: true },
      },
    ];
    if (complete) {
      events.push(await setState(hc, "authorized", "Both clients approved; the return is authorized for e-filing (simulated)."));
      await notify(tx, ctx.workspace.id, revision, [
        { recipientId: ctx.workspace.assignedPartner, kind: "authorized", title: "Client authorization complete", body: "Both spouses approved the presented return. It can be submitted.", refs: [`snapshot:${snap.id}`] },
      ]);
    }
    return { result: { approvalId: id, complete }, events };
  },
});

/**
 * Submit (simulated transmission). Re-checks readiness and approvals inside the
 * locked transaction, freezes the payload per attempt, and locks the workpaper.
 * California is held until the federal return is accepted, as in the packet.
 */
registerHandler({
  type: "submit_filing",
  schema: z.object({ jurisdictions: z.array(z.enum(["federal", "california"])).min(1).max(2).default(["federal", "california"]) }),
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "sign_off_partner", "submit the return");
    if (ctx.workspace.workflowState !== "authorized") throw new CommandError("invalid_state", `The return is ${ctx.workspace.workflowState.replace(/_/g, " ")}, not authorized.`);
    const state = await loadWorkspaceState(tx, ctx);
    const readiness = await filingReadiness(tx, ctx, state);
    if (!readiness.ok) throw new CommandError("invalid_state", `Prerequisites failed at submission time: ${readiness.blocking.map((b) => b.step).join(", ")}.`);
    const approvals = readiness.items.find((i) => i.step.startsWith("Client approval"));
    if (!approvals?.ok) throw new CommandError("invalid_state", "Client approvals do not match the current presentation.");
    const std = await currentStandards(tx, ctx.workspace.id, ctx.packet.packet.firm.starter_standards);
    const approvalRows = await tx.select().from(t.clientApprovals).where(and(eq(t.clientApprovals.workspaceId, ctx.workspace.id), eq(t.clientApprovals.status, "approved")));
    const { payload, hash } = buildSnapshotPayload({ ...ctx, workspace: { ...ctx.workspace, revision } }, state, std.id);
    const snapId = newId("snp");
    await tx.insert(t.filingSnapshots).values({
      id: snapId,
      workspaceId: ctx.workspace.id,
      kind: "submission",
      revision,
      contentHash: hash,
      payload: { ...payload, approvals: approvalRows.map((a) => ({ personId: a.personId, signedAt: a.signedAt, presentationHash: a.presentationHash, simulated: true })) },
      createdBy: ctx.actor.id,
      businessTime: hc.businessTime,
    });
    const prior = await tx.select().from(t.submissions).where(eq(t.submissions.workspaceId, ctx.workspace.id));
    const events: AuditSeed[] = [];
    const created: { id: string; jurisdiction: string; status: string }[] = [];
    for (const jurisdiction of ["federal", "california"] as const) {
      if (!p.jurisdictions.includes(jurisdiction)) continue;
      const attempt = prior.filter((s) => s.jurisdiction === jurisdiction).length + 1;
      const id = newId("sub");
      const federalAccepted = prior.some((s) => s.jurisdiction === "federal" && s.status === "accepted");
      const status = jurisdiction === "california" && !federalAccepted ? "not_transmitted" : "submitted";
      await tx.insert(t.submissions).values({
        id,
        workspaceId: ctx.workspace.id,
        snapshotId: snapId,
        jurisdiction,
        attempt,
        submissionRef: `SIM-${ctx.workspace.id.slice(3)}-${jurisdiction === "federal" ? "F" : "CA"}-${attempt}`,
        status,
        errors: status === "not_transmitted" ? [{ code: "STATE-HOLD", message: "State return held until the federal return is accepted." }] : [],
        simulated: true,
        submittedAt: hc.businessTime,
        createdRevision: revision,
      });
      created.push({ id, jurisdiction, status });
      events.push({
        action: "submission_created",
        entityType: "submission",
        entityId: id,
        summary: `${ctx.actor.name} submitted the ${jurisdiction} return (simulated transmission, attempt ${attempt}, frozen payload ${hash.slice(0, 12)})${status === "not_transmitted" ? "; held until federal acceptance" : ""}.`,
        after: { jurisdiction, attempt, status, snapshotId: snapId, contentHash: hash },
      });
    }
    await tx.update(t.workspaces).set({ filingLocked: true }).where(eq(t.workspaces.id, ctx.workspace.id));
    events.push(await setState(hc, "submitted", "Return submitted (simulated); the workpaper is frozen while the agencies respond."));
    return { result: { snapshotId: snapId, submissions: created }, events };
  },
});

/** Record the agency response for one attempt. Rejection unlocks the workpaper for corrections. */
registerHandler({
  type: "record_submission_outcome",
  schema: z.object({
    submissionId: z.string().min(1),
    outcome: z.enum(["accepted", "rejected"]),
    errors: z.array(z.object({ code: z.string().min(1), message: z.string().min(1) })).max(20).default([]),
    fromPacketEfileIndex: z.number().int().nonnegative().optional(),
  }),
  allowedWhenLocked: true,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "sign_off_reviewer", "record agency responses");
    const [sub] = await tx.select().from(t.submissions).where(and(eq(t.submissions.id, p.submissionId), eq(t.submissions.workspaceId, ctx.workspace.id)));
    if (!sub) throw new CommandError("not_found", "Submission not found.");
    if (sub.status !== "submitted") throw new CommandError("invalid_state", `Submission is ${sub.status.replace(/_/g, " ")}; only a transmitted attempt gets an outcome.`);
    let errors = p.errors;
    if (p.fromPacketEfileIndex !== undefined) {
      const efile = (ctx.packet.packet.tax_agency_records.efile as { errors?: { code: string; message: string }[] }[])[p.fromPacketEfileIndex];
      if (!efile) throw new CommandError("validation", "No such e-file record in the packet.");
      errors = efile.errors ?? [];
    }
    if (p.outcome === "rejected" && errors.length === 0) throw new CommandError("validation", "A rejection needs the agency's error codes.");
    await tx
      .update(t.submissions)
      .set({ status: p.outcome, errors, decidedAt: hc.businessTime, decidedRevision: revision })
      .where(eq(t.submissions.id, sub.id));
    const events: AuditSeed[] = [
      {
        action: p.outcome === "accepted" ? "submission_accepted" : "submission_rejected",
        entityType: "submission",
        entityId: sub.id,
        summary: `${sub.jurisdiction} attempt ${sub.attempt} ${p.outcome}${errors.length ? `: ${errors.map((e) => `${e.code} ${e.message}`).join("; ")}` : "."}`,
        before: { status: "submitted" },
        after: { status: p.outcome, errors },
      },
    ];
    const all = await tx.select().from(t.submissions).where(eq(t.submissions.workspaceId, ctx.workspace.id));
    if (p.outcome === "rejected") {
      // Hold any state return of the same attempt that was not transmitted; unlock for corrections.
      await tx.update(t.workspaces).set({ filingLocked: false }).where(eq(t.workspaces.id, ctx.workspace.id));
      events.push(await setState(hc, "rejected", `Return rejected by the ${sub.jurisdiction} agency; the workpaper is unlocked for corrections and must be re-presented and re-approved.`));
      await notify(tx, ctx.workspace.id, revision, [
        { recipientId: ctx.workspace.assignedPreparer, kind: "rejection", title: `${sub.jurisdiction} e-file rejected`, body: errors.map((e) => `${e.code}: ${e.message}`).join("\n"), refs: [`submission:${sub.id}`] },
      ]);
    } else if (sub.jurisdiction === "federal") {
      // Federal accepted: release the held California attempt from the same snapshot.
      const held = all.find((s) => s.jurisdiction === "california" && s.snapshotId === sub.snapshotId && s.status === "not_transmitted");
      if (held) {
        await tx.update(t.submissions).set({ status: "submitted", errors: [], submittedAt: hc.businessTime }).where(eq(t.submissions.id, held.id));
        events.push({ action: "submission_transmitted", entityType: "submission", entityId: held.id, summary: `California attempt ${held.attempt} transmitted after federal acceptance (simulated).`, before: { status: "not_transmitted" }, after: { status: "submitted" } });
      }
    }
    const refreshed = await tx.select().from(t.submissions).where(eq(t.submissions.workspaceId, ctx.workspace.id));
    const fedAccepted = refreshed.some((s) => s.jurisdiction === "federal" && s.status === "accepted");
    const caAccepted = refreshed.some((s) => s.jurisdiction === "california" && s.status === "accepted");
    if (p.outcome === "accepted" && fedAccepted && caAccepted) {
      const [snap] = await tx.select().from(t.filingSnapshots).where(eq(t.filingSnapshots.id, sub.snapshotId));
      const acceptedId = newId("snp");
      await tx.insert(t.filingSnapshots).values({
        id: acceptedId,
        workspaceId: ctx.workspace.id,
        kind: "accepted",
        revision,
        contentHash: snap.contentHash,
        payload: { ...(snap.payload as object), acceptedAt: hc.businessTime, submissions: refreshed.map((s) => ({ id: s.id, jurisdiction: s.jurisdiction, attempt: s.attempt, status: s.status, submissionRef: s.submissionRef })) },
        createdBy: ctx.actor.id,
        businessTime: hc.businessTime,
      });
      events.push(await setState(hc, "accepted", "Both returns accepted (simulated). The filed return is frozen; later changes go to an amendment."));
      events.push({ action: "return_frozen", entityType: "snapshot", entityId: acceptedId, summary: `Accepted return frozen as ${snap.contentHash.slice(0, 12)}.`, after: { snapshotId: acceptedId } });
    }
    return { result: { submissionId: sub.id, status: p.outcome, workflowState: fedAccepted && caAccepted ? "accepted" : p.outcome === "rejected" ? "rejected" : "submitted" }, events };
  },
});

/** Branch an amendment from the accepted return. The original workspace stays frozen. */
registerHandler({
  type: "start_amendment",
  schema: z.object({ reason: z.string().min(3).max(2000) }),
  allowedWhenLocked: true,
  async handle(hc, p) {
    const { tx, ctx } = hc;
    requirePermission(ctx.actor, "sign_off_partner", "start an amendment");
    if (ctx.workspace.workflowState !== "accepted") throw new CommandError("invalid_state", "Only an accepted return can be amended.");
    const accepted = await latestSnapshot(tx, ctx.workspace.id, "accepted");
    if (!accepted) throw new CommandError("invalid_state", "No accepted snapshot found.");
    const id = newId("ws", 8);
    const v = indexPacket(ctx.packet.packet).versions.get(ctx.workspace.activeVersion)!;
    await tx.insert(t.workspaces).values({
      id,
      packetId: ctx.workspace.packetId,
      name: `${ctx.workspace.name}, amendment`,
      revision: 0,
      asOf: hc.businessTime,
      activeVersion: v.version,
      workflowState: "amending",
      filingLocked: false,
      assignedPreparer: ctx.workspace.assignedPreparer,
      assignedReviewer: ctx.workspace.assignedReviewer,
      assignedPartner: ctx.workspace.assignedPartner,
      parentWorkspaceId: ctx.workspace.id,
      amendsSnapshotId: accepted.id,
    });
    // The amendment starts from the filed facts: accepted changes are carried as accepted, with their origin.
    const carried = await tx.select().from(t.adjustments).where(and(eq(t.adjustments.workspaceId, ctx.workspace.id), eq(t.adjustments.status, "accepted")));
    for (const a of carried) {
      await tx.insert(t.adjustments).values({ ...a, id: newId("adj"), workspaceId: id, createdRevision: 0, decidedRevision: 0, reason: `${a.reason} [carried from filed return ${ctx.workspace.id}, adjustment ${a.id}]` });
    }
    await tx.insert(t.scopeContributions).values({ workspaceId: id, scopeType: "engagement", scopeId: "*", actorId: ctx.workspace.assignedPreparer, kind: "assignment", revision: 0 });
    await tx.insert(t.auditEvents).values({
      workspaceId: id,
      revision: 0,
      actorId: ctx.actor.id,
      action: "amendment_started",
      entityType: "workspace",
      entityId: id,
      summary: `Amendment of ${ctx.workspace.id} started from accepted snapshot ${accepted.contentHash.slice(0, 12)}: ${p.reason}`,
      businessTime: hc.businessTime,
    });
    return {
      result: { amendmentWorkspaceId: id, amendsSnapshotId: accepted.id },
      events: [
        {
          action: "amendment_branched",
          entityType: "workspace",
          entityId: id,
          summary: `${ctx.actor.name} started amendment workspace ${id} from the accepted return: ${p.reason}`,
          after: { amendmentWorkspaceId: id, amendsSnapshotId: accepted.id, carriedAdjustments: carried.length },
        },
      ],
    };
  },
});

/** Next year's starting record: carryovers, basis histories and open items, never a computed 2026 return. */
registerHandler({
  type: "start_next_year",
  schema: z.object({ note: z.string().max(2000).optional() }),
  allowedWhenLocked: true,
  async handle(hc, p) {
    const { tx, ctx, revision } = hc;
    requirePermission(ctx.actor, "propose_adjustment", "start next year's record");
    const packet = ctx.packet.packet;
    const v = indexPacket(packet).versions.get(ctx.workspace.activeVersion)!;
    const [openFindings, openTasks, judgments] = await Promise.all([
      tx.select().from(t.findings).where(and(eq(t.findings.workspaceId, ctx.workspace.id), eq(t.findings.status, "open"))),
      tx.select().from(t.tasks).where(and(eq(t.tasks.workspaceId, ctx.workspace.id), eq(t.tasks.status, "open"))),
      tx.select().from(t.judgments).where(and(eq(t.judgments.workspaceId, ctx.workspace.id), eq(t.judgments.status, "recorded"))),
    ]);
    const accepted = await latestSnapshot(tx, ctx.workspace.id, "accepted");
    const payload = {
      successorTaxYear: 2026,
      basedOn: { workspaceId: ctx.workspace.id, version: v.version, acceptedSnapshotId: accepted?.id ?? null, acceptedHash: accepted?.contentHash ?? null },
      carryoversOut: v.carryovers_out,
      basisHistories: { prior: packet.prior_years.basis_records, assets2025: v.assets.map((a) => ({ asset_id: a.asset_id, federal: a.federal, california: a.california, amt: a.amt, disposed: a.disposed })) },
      openItems: { findings: openFindings.map((f) => ({ id: f.id, title: f.title, refs: f.refs })), tasks: openTasks.map((x) => ({ id: x.id, title: x.title, dueAt: x.dueAt })) },
      judgmentsToRevisit: judgments.map((j) => ({ id: j.id, kind: j.kind, title: j.title, subjectRef: j.subjectRef })),
      planningReference: packet.planning_reference_2026,
      note: "No 2026 computation exists; this record carries history and open items forward with their origins.",
    };
    const id = newId("snp");
    await tx.insert(t.filingSnapshots).values({
      id,
      workspaceId: ctx.workspace.id,
      kind: "carryforward",
      revision,
      contentHash: "n/a",
      payload,
      createdBy: ctx.actor.id,
      businessTime: hc.businessTime,
    });
    const taskId = newId("tsk");
    await tx.insert(t.tasks).values({
      id: taskId,
      workspaceId: ctx.workspace.id,
      kind: "planning",
      title: "2026 estimated payments: safe harbor plan",
      detail: `Federal: ${String((packet.planning_reference_2026 as { federal_safe_harbor?: string }).federal_safe_harbor)} California: ${String((packet.planning_reference_2026 as { california_safe_harbor?: string }).california_safe_harbor)}`,
      ownerId: ctx.workspace.assignedPreparer,
      dueAt: "2026-04-15T00:00:00Z",
      status: "open",
      refs: [`snapshot:${id}`],
      area: "tax_computation_and_payments",
      createdBy: ctx.actor.id,
      createdRevision: revision,
    });
    return {
      result: { carryforwardId: id, planningTaskId: taskId },
      events: [
        {
          action: "next_year_started",
          entityType: "snapshot",
          entityId: id,
          summary: `${ctx.actor.name} created the 2026 successor record with carryovers, basis history, ${openFindings.length} open finding(s) and ${openTasks.length} open task(s)${p.note ? `: ${p.note}` : "."}`,
          after: { carryforwardId: id, planningTaskId: taskId },
        },
      ],
    };
  },
});
