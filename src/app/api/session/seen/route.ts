import { NextResponse } from "next/server";
import * as t from "@/db/schema";
import { sql } from "drizzle-orm";
import { getSessionContext } from "@/server/request";

/** Record that this person has looked at the workpaper up to the current revision. */
export async function POST() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  const revision = ctx.workspace.revision;
  await ctx.db
    .insert(t.seenCursors)
    .values({ workspaceId: ctx.workspace.id, actorId: ctx.actor.id, revision })
    .onConflictDoUpdate({
      target: [t.seenCursors.workspaceId, t.seenCursors.actorId],
      set: { revision, updatedAt: sql`now()` },
    });
  return NextResponse.json({ ok: true, revision });
}
