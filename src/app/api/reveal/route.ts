import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/server/request";
import { revealField } from "@/server/reveal";

const bodySchema = z.object({
  ref: z.string().min(1).max(80),
  field: z.string().min(1).max(60),
});

/**
 * Reveal one sensitive field for the session's actor. The response carries
 * the value exactly once and is deliberately not passed through the redactor;
 * nothing else on this path (audit, view log, console) ever sees it.
 */
export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, code: "no_session", message: "Start or join a workspace first." }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "validation", message: "Body must be JSON with ref and field." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: "validation", message: "Body must name a ref and a field." }, { status: 400 });
  }
  const result = await revealField(ctx, parsed.data);
  const status = result.ok ? 200 : result.code === "forbidden" ? 403 : result.code === "not_found" ? 404 : 400;
  return NextResponse.json(result, { status, headers: { "cache-control": "no-store" } });
}
