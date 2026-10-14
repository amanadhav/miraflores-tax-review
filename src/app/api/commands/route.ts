import { NextResponse } from "next/server";
import { makeRedactor } from "@/domain/redaction";
import { dispatch, envelopeSchema } from "@/server/handlers";
import { getSessionContext } from "@/server/request";

/**
 * Every mutation enters here. The body never names the actor or workspace:
 * both come from the session cookie. Responses are redacted for the viewer.
 */
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: { code: "no_session", message: "Start or join a workspace first." } }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: { code: "validation", message: "Body must be JSON." } }, { status: 400 });
  }
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "validation", message: "Command envelope is not valid.", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400 },
    );
  }
  const result = await dispatch(ctx, parsed.data);
  const redact = makeRedactor(ctx.packet.packet);
  const status = result.ok ? 200 : result.error.code === "conflict" ? 409 : result.error.code === "internal" ? 500 : result.error.code === "not_found" ? 404 : result.error.code === "validation" ? 400 : 403;
  return NextResponse.json(redact.deep(result), { status });
}
