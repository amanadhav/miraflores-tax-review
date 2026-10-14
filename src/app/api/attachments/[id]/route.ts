import { NextResponse } from "next/server";
import { attachmentForViewer, ExportError } from "@/server/export";
import { getSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/** Content types that are safe to hand to a browser as they are; anything else downloads as bytes. */
const INLINE_TYPES = /^(text\/plain|application\/pdf|image\/(png|jpeg|gif|webp)|application\/json)(;|$)/i;

/**
 * GET /api/attachments/[id]
 * The attachment's content with its content type, for the session's
 * workspace. Clients get their own uploads and the attachments of requests
 * addressed to them; the server decides, never the page.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ ok: false, error: { code: "no_session", message: "Start or join a workspace first." } }, { status: 401 });
  const { id } = await params;
  try {
    const att = await attachmentForViewer(ctx, id);
    const contentType = INLINE_TYPES.test(att.contentType) ? att.contentType : "application/octet-stream";
    const safeName = att.filename.replace(/[^\w.\-() ]+/g, "_");
    return new Response(new Uint8Array(att.bytes), {
      headers: {
        "content-type": contentType,
        "content-length": String(att.bytes.length),
        "content-disposition": `attachment; filename="${safeName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : 409 });
    }
    throw error;
  }
}
