import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import { parseRef, type WorkpaperTable } from "@/packet/refs";

const TABLES: Record<WorkpaperTable, { table: { id: unknown; workspaceId: unknown } } | null> = {
  adjustment: { table: t.adjustments },
  anchor: { table: t.anchors },
  finding: { table: t.findings },
  verification: { table: t.verifications },
  signoff: { table: t.signoffs },
  request: { table: t.requests },
  reply: { table: t.requestReplies },
  attachment: { table: t.attachments },
  judgment: { table: t.judgments },
  task: { table: t.tasks },
  disposition: { table: t.dispositions },
  snapshot: { table: t.filingSnapshots },
  submission: { table: t.submissions },
};

/** Workpaper references must point at records that exist in this workspace. */
export async function missingWorkpaperRefs(db: Db, workspaceId: string, refs: string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const ref of refs) {
    const parsed = parseRef(ref);
    if (parsed.kind !== "workpaper") continue;
    const entry = TABLES[parsed.table];
    if (!entry) {
      missing.push(ref);
      continue;
    }
    const table = entry.table as typeof t.adjustments;
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, parsed.id), eq(table.workspaceId, workspaceId)))
      .limit(1);
    if (rows.length === 0) missing.push(ref);
  }
  return missing;
}
