import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import { importPacket } from "@/packet/import";
import { indexPacket, type LoadedPacket } from "@/packet/load";
import { parseRef } from "@/packet/refs";
import { areaForLine } from "@/domain/areas";
import { findActor } from "@/domain/policy";
import { newId, newSessionId } from "./ids";
import type { SessionRow, WorkspaceRow } from "./context";

export const DEFAULT_VERSION = "v3";

/**
 * A workspace is one evaluator's copy of the engagement. The packet is shared
 * and immutable; everything a person does lives in their workspace, so a reset
 * or another visitor's work never touches anyone else's.
 */
export async function createWorkspace(db: Db, loaded: LoadedPacket, name?: string): Promise<WorkspaceRow> {
  const { packetId } = await importPacket(db, loaded);
  const packet = loaded.packet;
  const idx = indexPacket(packet);
  const v3 = idx.versions.get(DEFAULT_VERSION);
  if (!v3) throw new Error(`Packet has no ${DEFAULT_VERSION}`);
  const id = newId("ws", 8);
  const assignment = packet.firm.assignment_at_start;
  const row: typeof t.workspaces.$inferInsert = {
    id,
    packetId,
    name: name ?? `${packet.packet.name} (${id.slice(3)})`,
    revision: 0,
    asOf: v3.computed_at,
    activeVersion: DEFAULT_VERSION,
    workflowState: "preparing",
    filingLocked: false,
    assignedPreparer: assignment.preparer,
    assignedReviewer: assignment.reviewer,
    assignedPartner: assignment.partner,
  };
  await db.transaction(async (tx) => {
    await tx.insert(t.workspaces).values(row);
    // The engine's diagnostics become findings that keep their origin; they are
    // re-evaluated by version fingerprint, never carried blindly between versions.
    const seeds = v3.diagnostics.map((d) => {
      const lineRef = d.refs.map(parseRef).find((r) => r.kind === "line");
      const area = lineRef && lineRef.kind === "line" ? areaForLine(lineRef.key, lineRef.form) : "tax_computation_and_payments";
      const fingerprint = createHash("sha256").update(JSON.stringify([v3.version, d.code, d.message, d.refs])).digest("hex");
      return {
        id: newId("fnd"),
        workspaceId: id,
        origin: "engine_diagnostic",
        code: d.code,
        severity: d.severity,
        title: d.code.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
        detail: d.message,
        refs: d.refs,
        area,
        blocksFiling: d.severity === "warning",
        status: "open",
        ownerId: assignment.preparer,
        createdBy: "engine",
        createdRevision: 0,
        engineVersion: v3.version,
        fingerprint,
      };
    });
    if (seeds.length) await tx.insert(t.findings).values(seeds);
    await tx.insert(t.scopeContributions).values({
      workspaceId: id,
      scopeType: "engagement",
      scopeId: "*",
      actorId: assignment.preparer,
      kind: "assignment",
      revision: 0,
    });
    await tx.insert(t.auditEvents).values({
      workspaceId: id,
      revision: 0,
      actorId: "system",
      action: "workspace_created",
      entityType: "workspace",
      entityId: id,
      summary: `Workspace created from packet ${packetId.slice(0, 12)} at ${v3.version} (${v3.computed_at}); ${seeds.length} engine diagnostics loaded as findings.`,
      businessTime: v3.computed_at,
    });
  });
  const [created] = await db.select().from(t.workspaces).where(eq(t.workspaces.id, id));
  return created;
}

export async function createSession(db: Db, loaded: LoadedPacket, workspaceId: string, actorId: string): Promise<SessionRow> {
  const actor = findActor(loaded.packet, actorId);
  if (!actor) throw new Error(`Unknown actor ${actorId}`);
  const id = newSessionId();
  await db.insert(t.sessions).values({ id, workspaceId, actorId });
  const [row] = await db.select().from(t.sessions).where(eq(t.sessions.id, id));
  return row;
}

export async function getWorkspace(db: Db, id: string): Promise<WorkspaceRow | undefined> {
  const [row] = await db.select().from(t.workspaces).where(eq(t.workspaces.id, id));
  return row;
}
