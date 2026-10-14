import { NextResponse } from "next/server";
import { getSessionContext } from "@/server/request";

/** Lightweight poll target for live refresh. */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true, revision: ctx.workspace.revision, asOf: ctx.workspace.asOf, actorId: ctx.actor.id });
}
