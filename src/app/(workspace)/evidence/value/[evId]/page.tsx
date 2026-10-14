import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionContext } from "@/server/request";
import { locateExtractedValue } from "@/server/queries/evidence";

export const dynamic = "force-dynamic";

/** An extracted value's home is its source page, opened with that value selected. */
export default async function ExtractedValuePage({ params }: { params: Promise<{ evId: string }> }) {
  const ctx = await requireSessionContext();
  const { evId } = await params;
  const hit = locateExtractedValue(ctx, evId);
  if (hit) redirect(`/evidence/${hit.documentId}?page=${hit.page}&ev=${encodeURIComponent(evId)}`);
  return (
    <div className="max-w-2xl space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Extracted value not found</h1>
      <p className="text-sm text-stone-600">
        <span className="num">{evId}</span> is not an extracted value in this packet. A return line or workpaper record that cites it has unresolved
        evidence; raise a finding on that line rather than guessing at a source.
      </p>
      <Link href="/evidence" className="text-sm text-blue-700 hover:underline">
        Back to the document index
      </Link>
    </div>
  );
}
