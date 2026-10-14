import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import type { StarterStandards } from "@/packet/types";

export interface CurrentStandards {
  version: number;
  id: string; // "starter-standards-v1" for the packet default, else the row id
  standards: StarterStandards;
  note: string;
}

/** The standard in force for a workspace: the packet's starter standard until an administrator publishes a new version. */
export async function currentStandards(db: Db, workspaceId: string, starter: StarterStandards): Promise<CurrentStandards> {
  const [row] = await db
    .select()
    .from(t.standardsVersions)
    .where(eq(t.standardsVersions.workspaceId, workspaceId))
    .orderBy(desc(t.standardsVersions.version))
    .limit(1);
  if (!row) return { version: 1, id: "starter-standards-v1", standards: starter, note: "Packet starter standards." };
  return { version: row.version, id: row.id, standards: row.standards as StarterStandards, note: row.note };
}

export async function standardsHistory(db: Db, workspaceId: string) {
  return db
    .select()
    .from(t.standardsVersions)
    .where(and(eq(t.standardsVersions.workspaceId, workspaceId)))
    .orderBy(desc(t.standardsVersions.version));
}
