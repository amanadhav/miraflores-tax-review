import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { findActor } from "@/domain/policy";
import { loadPacket } from "@/packet/load";
import { SESSION_COOKIE } from "@/server/context";
import { createSession, getWorkspace } from "@/server/workspace";

/** Join an existing workspace in a second browser as a chosen persona (two-person demo). */
export async function POST(request: Request) {
  const { db } = await getDb();
  const loaded = loadPacket();
  const form = await request.formData().catch(() => null);
  const workspaceId = String(form?.get("workspaceId") ?? "").trim();
  const actorId = String(form?.get("actorId") ?? "st-02").trim();
  const workspace = workspaceId ? await getWorkspace(db, workspaceId) : undefined;
  if (!workspace) return NextResponse.redirect(new URL("/?error=unknown-workspace", request.url), 303);
  if (!findActor(loaded.packet, actorId)) return NextResponse.redirect(new URL("/?error=unknown-person", request.url), 303);
  const session = await createSession(db, loaded, workspace.id, actorId);
  const res = NextResponse.redirect(new URL("/overview", request.url), 303);
  res.cookies.set(SESSION_COOKIE, session.id, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
