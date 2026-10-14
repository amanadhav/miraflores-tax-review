import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import type { LoadedPacket } from "@/packet/load";
import { findActor, type Actor } from "@/domain/policy";

export const SESSION_COOKIE = "trace_session";

export type WorkspaceRow = typeof t.workspaces.$inferSelect;
export type SessionRow = typeof t.sessions.$inferSelect;

export interface SessionContext {
  db: Db;
  packet: LoadedPacket;
  session: SessionRow;
  workspace: WorkspaceRow;
  actor: Actor;
}

/** Load the session named by a cookie value. Returns null when it is missing or stale. */
export async function loadSessionContext(db: Db, packet: LoadedPacket, sessionId: string | undefined): Promise<SessionContext | null> {
  if (!sessionId) return null;
  const [session] = await db.select().from(t.sessions).where(eq(t.sessions.id, sessionId));
  if (!session) return null;
  const [workspace] = await db.select().from(t.workspaces).where(eq(t.workspaces.id, session.workspaceId));
  if (!workspace) return null;
  if (packet.sha256 !== workspace.packetId) return null;
  const actor = findActor(packet.packet, session.actorId);
  if (!actor) return null;
  return { db, packet, session, workspace, actor };
}

/** Re-read the workspace row (revision, clock, state) for an existing context. */
export async function refreshContext(ctx: SessionContext): Promise<SessionContext> {
  const [workspace] = await ctx.db.select().from(t.workspaces).where(eq(t.workspaces.id, ctx.workspace.id));
  return { ...ctx, workspace };
}
