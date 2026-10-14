/**
 * Logged reveal of one sensitive value. Everything a browser receives is
 * masked by default; a cleared staff member reveals a single field at a
 * time through this module, and every attempt, allowed or refused, writes a
 * view event and an audit event. The value itself is returned once and is
 * never written to either record, to a log line, or to the summary text.
 *
 * A reveal is a logged read, not a workpaper change: the workspace revision
 * is recorded on the rows but never bumped.
 */
import * as t from "@/db/schema";
import { can } from "@/domain/policy";
import { makeRedactor } from "@/domain/redaction";
import { indexPacket } from "@/packet/load";
import type { Packet } from "@/packet/types";
import type { SessionContext } from "./context";

export interface RevealRequest {
  ref: string;
  field: string;
}

export type RevealResult =
  | { ok: true; value: string }
  | { ok: false; code: "forbidden" | "not_found" | "unsupported"; message: string };

type Lookup = { ok: true; value: string } | { ok: false; code: "not_found" | "unsupported"; message: string };

const SUPPORTED =
  "household:<person> (ssn, ip_pin), household:bank (routing, account), ev-NNNN (value), firm:identity (efin, ero_pin, ptin:<staff>), timeline:tl-20 (taxpayer_pin, spouse_pin)";

/** Find the raw value for a supported target. Never called before the policy check. */
function lookup(packet: Packet, ref: string, field: string): Lookup {
  const idx = indexPacket(packet);
  const unsupported = (message: string): Lookup => ({ ok: false, code: "unsupported", message });
  const notFound = (message: string): Lookup => ({ ok: false, code: "not_found", message });

  if (ref === "household:bank") {
    const bank = packet.household.bank_account_for_refund_or_payment;
    if (field === "routing") return { ok: true, value: bank.routing };
    if (field === "account") return { ok: true, value: bank.account };
    return unsupported(`household:bank has no revealable field "${field}"; use routing or account.`);
  }

  if (ref.startsWith("household:")) {
    const person = idx.people.get(ref.slice("household:".length));
    if (!person) return notFound(`${ref} is not a household member in the packet.`);
    if (field === "ssn") return { ok: true, value: person.ssn };
    if (field === "ip_pin") {
      if (!person.ip_pin) return notFound(`${person.name} has no IP PIN on file.`);
      return { ok: true, value: person.ip_pin };
    }
    return unsupported(`${ref} has no revealable field "${field}"; use ssn or ip_pin.`);
  }

  if (/^ev-\d+$/.test(ref)) {
    const ev = idx.extractedValues.get(ref);
    if (!ev) return notFound(`${ref} is not an extracted value in the packet.`);
    if (field !== "value") return unsupported(`Extracted values only support the field "value".`);
    if (ev.value_type !== "ssn" && ev.value_type !== "account_number") {
      return unsupported(`${ref} is a ${ev.value_type.replace(/_/g, " ")} and is not masked; read it on the evidence page.`);
    }
    return { ok: true, value: typeof ev.value === "string" ? ev.value : ev.text_as_read };
  }

  if (ref === "firm:identity") {
    const identity = packet.firm.firm_identity;
    if (field === "efin") return { ok: true, value: identity.efin };
    if (field === "ero_pin") return { ok: true, value: identity.ero_pin };
    if (field.startsWith("ptin:")) {
      const staffId = field.slice("ptin:".length);
      const ptin = identity.ptins[staffId];
      if (!ptin) return notFound(`No PTIN is on file for ${staffId}.`);
      return { ok: true, value: ptin };
    }
    return unsupported(`firm:identity has no revealable field "${field}"; use efin, ero_pin or ptin:<staff id>.`);
  }

  if (ref === "timeline:tl-20") {
    const event = idx.timeline.get("tl-20");
    const detail = event?.detail ?? "";
    if (!event) return notFound("Timeline event tl-20 is not in the packet.");
    const taxpayer = detail.match(/Taxpayer PIN\s+(\d{4,6})/i)?.[1];
    const spouse = detail.match(/spouse PIN\s+(\d{4,6})/i)?.[1];
    if (field === "taxpayer_pin") return taxpayer ? { ok: true, value: taxpayer } : notFound("No taxpayer PIN is recorded on tl-20.");
    if (field === "spouse_pin") return spouse ? { ok: true, value: spouse } : notFound("No spouse PIN is recorded on tl-20.");
    return unsupported(`timeline:tl-20 has no revealable field "${field}"; use taxpayer_pin or spouse_pin.`);
  }

  return unsupported(`${ref} is not a revealable target. Supported: ${SUPPORTED}.`);
}

/**
 * Targets are caller input and end up in the log, so they are trimmed, limited
 * to reference characters and passed through the redactor: a sensitive value
 * typed into the target can never be stored by way of the log itself.
 */
function safeTarget(ctx: SessionContext, raw: string): string {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/[^A-Za-z0-9:_.#-]/g, "")
    .slice(0, 80);
  return makeRedactor(ctx.packet.packet).text(cleaned);
}

export interface SensitiveAttempt {
  ref: string;
  field: string;
  outcome: "revealed" | "denied";
  /** Plain-language reason stored on both rows. Must never contain the value. */
  reason: string;
}

/**
 * Write the view event and the matching audit event for one attempt. Shared
 * with search, which refuses queries that are themselves sensitive values.
 */
export async function recordSensitiveAttempt(ctx: SessionContext, attempt: SensitiveAttempt): Promise<void> {
  const revision = ctx.workspace.revision;
  const target = `${attempt.ref} ${attempt.field}`;
  const summary =
    attempt.outcome === "revealed"
      ? `${ctx.actor.name} revealed ${target} (logged view; the value is not recorded here).`
      : `${ctx.actor.name} was refused ${target}: ${attempt.reason}`;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(t.viewEvents).values({
      workspaceId: ctx.workspace.id,
      actorId: ctx.actor.id,
      ref: attempt.ref,
      field: attempt.field,
      outcome: attempt.outcome,
      reason: attempt.reason,
      revision,
    });
    await tx.insert(t.auditEvents).values({
      workspaceId: ctx.workspace.id,
      revision,
      commandId: null,
      actorId: ctx.actor.id,
      action: attempt.outcome === "revealed" ? "sensitive_revealed" : "sensitive_reveal_denied",
      entityType: "sensitive_field",
      entityId: `${attempt.ref}#${attempt.field}`,
      summary,
      before: null,
      after: { ref: attempt.ref, field: attempt.field, outcome: attempt.outcome },
      area: null,
      businessTime: new Date(ctx.workspace.asOf).toISOString(),
    });
  });
}

/**
 * Reveal one field. The actor comes from the session, never from the request.
 * Policy is checked before the target is even resolved, so a refusal reveals
 * nothing about what exists.
 */
export async function revealField(ctx: SessionContext, request: RevealRequest): Promise<RevealResult> {
  const ref = safeTarget(ctx, request.ref);
  const field = safeTarget(ctx, request.field);
  const actor = ctx.actor;

  if (!can(actor, "reveal_sensitive")) {
    const reason =
      actor.role === "client"
        ? "client users cannot reveal full identifiers"
        : `${actor.name} has no sensitive-data clearance`;
    await recordSensitiveAttempt(ctx, { ref, field, outcome: "denied", reason });
    return {
      ok: false,
      code: "forbidden",
      message: `Not allowed: ${reason}. This attempt was logged.`,
    };
  }

  const found = lookup(ctx.packet.packet, ref, field);
  if (!found.ok) {
    await recordSensitiveAttempt(ctx, { ref, field, outcome: "denied", reason: `${found.code.replace(/_/g, " ")}: ${found.message}` });
    return { ok: false, code: found.code, message: found.message };
  }

  await recordSensitiveAttempt(ctx, {
    ref,
    field,
    outcome: "revealed",
    reason: `reveal_sensitive permission (${actor.role.replace(/_/g, " ")} with clearance)`,
  });
  return { ok: true, value: found.value };
}
