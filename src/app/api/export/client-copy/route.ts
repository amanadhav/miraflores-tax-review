import { NextResponse } from "next/server";
import { buildClientCopy, ExportError } from "@/server/export";
import { getSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

function errorStatus(code: ExportError["code"]): number {
  return code === "not_found" ? 404 : code === "forbidden" ? 403 : 409;
}

/**
 * GET /api/export/client-copy?snapshot=<id>&format=html|json
 * The frozen presentation as a self-contained document. The snapshot must
 * belong to the session's workspace; clients get client presentations only.
 */
export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: { code: "no_session", message: "Start or join a workspace first." } }, { status: 401 });
  const url = new URL(request.url);
  const snapshot = (url.searchParams.get("snapshot") ?? "").trim();
  const format = url.searchParams.get("format") === "json" ? "json" : "html";
  if (!snapshot) return NextResponse.json({ ok: false, error: { code: "validation", message: "A snapshot id is required." } }, { status: 400 });
  try {
    const copy = await buildClientCopy(ctx, snapshot);
    if (format === "json") {
      return new Response(JSON.stringify(copy.json, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="${copy.filename}.json"`,
          "cache-control": "no-store",
        },
      });
    }
    return new Response(copy.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${copy.filename}.html"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportError) return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: errorStatus(error.code) });
    throw error;
  }
}
