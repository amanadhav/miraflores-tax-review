import { NextResponse } from "next/server";
import { carryforwardExport, ExportError } from "@/server/export";
import { getSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * GET /api/export/carryforward?snapshot=<id>
 * Next year's starting record as JSON: carryovers, basis histories and open
 * items with their origins. Never a computed 2026 return. Staff only.
 */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: { code: "no_session", message: "Start or join a workspace first." } }, { status: 401 });
  const snapshot = (new URL(request.url).searchParams.get("snapshot") ?? "").trim();
  if (!snapshot) return NextResponse.json({ ok: false, error: { code: "validation", message: "A snapshot id is required." } }, { status: 400 });
  try {
    const out = await carryforwardExport(ctx, snapshot);
    return new Response(JSON.stringify(out.json, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${out.filename}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof ExportError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : 409 });
    }
    throw error;
  }
}
