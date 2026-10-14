import { NextResponse } from "next/server";
import { makeRedactor } from "@/domain/redaction";
import { search } from "@/server/queries/search";
import { getSessionContext } from "@/server/request";

/** GET /api/search?q=... Results are filtered by permission and the replay clock, and redacted for the viewer. */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: { code: "no_session", message: "Start or join a workspace first." } }, { status: 401 });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const result = await search(ctx, q.slice(0, 200));
  const redact = makeRedactor(ctx.packet.packet);
  return NextResponse.json(redact.deep({ ok: true, ...result }), { headers: { "cache-control": "no-store" } });
}
