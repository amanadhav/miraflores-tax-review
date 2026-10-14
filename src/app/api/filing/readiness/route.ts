import { NextResponse } from "next/server";
import { makeRedactor } from "@/domain/redaction";
import { filingReadiness } from "@/server/filing";
import { getSessionContext } from "@/server/request";

/** The firm's required steps evaluated from records, as JSON (staff only). */
export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: "no session" }, { status: 401 });
  if (ctx.actor.role === "client") return NextResponse.json({ ok: false, error: "staff only" }, { status: 403 });
  const readiness = await filingReadiness(ctx.db, ctx);
  return NextResponse.json(makeRedactor(ctx.packet.packet).deep({ ...readiness, ready: readiness.ok, revision: ctx.workspace.revision, workflowState: ctx.workspace.workflowState }));
}
