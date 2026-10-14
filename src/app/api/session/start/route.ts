import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { loadPacket } from "@/packet/load";
import { SESSION_COOKIE } from "@/server/context";
import { createSession, createWorkspace } from "@/server/workspace";

/** Start a fresh demo workspace as the assigned preparer. Never touches other workspaces. */
export async function POST(request: Request) {
  const { db } = await getDb();
  const loaded = loadPacket();
  const form = await request.formData().catch(() => null);
  const name = form?.get("name");
  const workspace = await createWorkspace(db, loaded, typeof name === "string" && name.trim() ? name.trim() : undefined);
  const session = await createSession(db, loaded, workspace.id, workspace.assignedPreparer);
  const res = NextResponse.redirect(new URL("/overview", request.url), 303);
  res.cookies.set(SESSION_COOKIE, session.id, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}
