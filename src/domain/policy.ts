/**
 * Server-side authorization. Every command is checked here with the actor
 * derived from the session, never from the request body. The rules come from
 * the packet's firm staff list and starter standards.
 */
import type { Packet, Staff, StaffRole } from "@/packet/types";

export type Role = StaffRole | "client";

export interface Actor {
  id: string;
  name: string;
  role: Role;
  credential: string | null;
  sensitiveClearance: boolean;
  activeFrom: string | null; // ISO date for staff; null for clients
}

export type Permission =
  | "view_workpaper"
  | "propose_adjustment"
  | "decide_adjustment"
  | "decide_material_adjustment"
  | "undo_adjustment"
  | "add_verification"
  | "add_anchor"
  | "raise_finding"
  | "resolve_finding"
  | "sign_off_preparer"
  | "sign_off_reviewer"
  | "sign_off_partner"
  | "reveal_sensitive"
  | "advance_time"
  | "manage_standards"
  | "manage_assignments"
  | "view_client_portal"
  | "view_filed_history";

const STAFF_PERMISSIONS: Record<StaffRole, Permission[]> = {
  preparer: [
    "view_workpaper",
    "propose_adjustment",
    "add_verification",
    "add_anchor",
    "raise_finding",
    "sign_off_preparer",
    "advance_time",
  ],
  reviewer: [
    "view_workpaper",
    "propose_adjustment",
    "decide_adjustment",
    "undo_adjustment",
    "add_verification",
    "add_anchor",
    "raise_finding",
    "resolve_finding",
    "sign_off_preparer",
    "sign_off_reviewer",
    "advance_time",
  ],
  partner: [
    "view_workpaper",
    "propose_adjustment",
    "decide_adjustment",
    "decide_material_adjustment",
    "undo_adjustment",
    "add_verification",
    "add_anchor",
    "raise_finding",
    "resolve_finding",
    "sign_off_preparer",
    "sign_off_reviewer",
    "sign_off_partner",
    "advance_time",
    "manage_assignments",
  ],
  firm_administrator: ["view_workpaper", "manage_standards", "manage_assignments", "advance_time", "raise_finding"],
  quality_reviewer: ["view_workpaper", "view_filed_history", "raise_finding", "advance_time"],
};

const CLIENT_PERMISSIONS: Permission[] = ["view_client_portal"];

export function actorsFromPacket(packet: Packet): Actor[] {
  const staff = packet.firm.staff.map(staffActor);
  const clients = packet.firm.client_users.map<Actor>((c) => ({
    id: c.id,
    name: c.name,
    role: "client",
    credential: null,
    sensitiveClearance: false,
    activeFrom: null,
  }));
  return [...staff, ...clients];
}

export function staffActor(s: Staff): Actor {
  return {
    id: s.id,
    name: s.name,
    role: s.role,
    credential: s.credential,
    sensitiveClearance: s.sensitive_data_clearance,
    activeFrom: s.active_from,
  };
}

export function findActor(packet: Packet, actorId: string): Actor | undefined {
  return actorsFromPacket(packet).find((a) => a.id === actorId);
}

export function permissionsFor(actor: Actor): Permission[] {
  if (actor.role === "client") return CLIENT_PERMISSIONS;
  const base = STAFF_PERMISSIONS[actor.role];
  return actor.sensitiveClearance ? [...base, "reveal_sensitive"] : base;
}

export function can(actor: Actor, permission: Permission): boolean {
  return permissionsFor(actor).includes(permission);
}

/** Staff become available on their packet `active_from` date in replay time. */
export function isAvailableAt(actor: Actor, asOfIso: string): boolean {
  if (!actor.activeFrom) return true;
  return actor.activeFrom <= asOfIso.slice(0, 10);
}

export type Level = "preparer" | "reviewer" | "partner";

export function signOffPermission(level: Level): Permission {
  return level === "preparer" ? "sign_off_preparer" : level === "reviewer" ? "sign_off_reviewer" : "sign_off_partner";
}

export class PolicyError extends Error {
  readonly code: "forbidden" | "unavailable" | "self_review" | "partner_required" | "filing_locked";
  constructor(code: PolicyError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function requirePermission(actor: Actor, permission: Permission, what: string): void {
  if (!can(actor, permission)) {
    throw new PolicyError("forbidden", `${actor.name} (${actor.role.replace(/_/g, " ")}) cannot ${what}.`);
  }
}

export function requireAvailable(actor: Actor, asOfIso: string): void {
  if (!isAvailableAt(actor, asOfIso)) {
    throw new PolicyError(
      "unavailable",
      `${actor.name} joins the firm on ${actor.activeFrom} and is not available at ${asOfIso.slice(0, 10)}.`,
    );
  }
}

/**
 * No self-review: the actor must not have prepared any part of the scope.
 * `preparers` is the full contribution history for the scope plus the
 * engagement's assigned preparer, so later role changes cannot launder it.
 */
export function requireIndependent(actor: Actor, preparers: Iterable<string>, scopeLabel: string): void {
  for (const id of preparers) {
    if (id === actor.id) {
      throw new PolicyError("self_review", `${actor.name} prepared part of ${scopeLabel} and cannot review or approve it.`);
    }
  }
}

/** Material effects need partner approval; the threshold is per jurisdiction and unsigned. */
export const PARTNER_THRESHOLD = 1000;

export function requiresPartner(effectFederal: number | null, effectCalifornia: number | null, unknownEffect: boolean): boolean {
  if (unknownEffect) return true; // conservative: unknown effect is treated as material
  return Math.abs(effectFederal ?? 0) > PARTNER_THRESHOLD || Math.abs(effectCalifornia ?? 0) > PARTNER_THRESHOLD;
}
