import { NextResponse } from "next/server";
import { buildNoticeBundle, ExportError } from "@/server/export";
import { getSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function errorStatus(code: ExportError["code"]): number {
  return code === "not_found" ? 404 : code === "forbidden" ? 403 : 409;
}

/**
 * GET /api/export/notice?notice=<id>&format=html|json
 * The response bundle for an agency notice available at the replay clock.
 * Staff only; the bundle is readable offline.
 */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: { code: "no_session", message: "Start or join a workspace first." } }, { status: 401 });
  const url = new URL(request.url);
  const notice = (url.searchParams.get("notice") ?? "").trim();
  const format = url.searchParams.get("format") === "json" ? "json" : "html";
  if (!notice) return NextResponse.json({ ok: false, error: { code: "validation", message: "A notice id is required." } }, { status: 400 });
  try {
    const bundle = await buildNoticeBundle(ctx, notice);
    if (format === "json") {
      return new Response(JSON.stringify(bundle.json, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${bundle.filename}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    return new Response(bundle.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${bundle.filename}.html"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: errorStatus(error.code) });
    throw error;
  }
}
