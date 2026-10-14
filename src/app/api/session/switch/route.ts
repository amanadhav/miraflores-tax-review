import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import * as t from "@/db/schema";
import { findActor } from "@/domain/policy";
import { getSessionContext } from "@/server/request";

/**
 * The role switcher. It changes which persona this browser session acts as;
 * it never grants a permission by itself because every command re-derives
 * the actor from the session and checks policy server-side.
 */
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.redirect(new URL("/", request.url), 303);
  const form = await request.formData().catch(() => null);
  const actorId = String(form?.get("actorId") ?? "").trim();
  const next = String(form?.get("next") ?? "/overview");
  const actor = findActor(ctx.packet.packet, actorId);
  if (!actor) return NextResponse.redirect(new URL(next, request.url), 303);
  await ctx.db.update(t.sessions).set({ actorId, lastSeenAt: new Date().toISOString() }).where(eq(t.sessions.id, ctx.session.id));
  await ctx.db.insert(t.auditEvents).values({
    workspaceId: ctx.workspace.id,
    revision: ctx.workspace.revision,
    actorId,
    action: "session_persona_switched",
    entityType: "session",
    entityId: ctx.session.id,
    summary: `Browser session switched from ${ctx.actor.name} to ${actor.name} (demo role switcher; permissions re-evaluated per command).`,
    businessTime: ctx.workspace.asOf,
  });
  const safeNext = next.startsWith("/") ? next : "/overview";
  return NextResponse.redirect(new URL(actor.role === "client" ? "/client" : safeNext, request.url), 303);
}
