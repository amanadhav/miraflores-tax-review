import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import { newId } from "./ids";

export interface NotificationSeed {
  recipientId: string;
  kind: string;
  title: string;
  body: string;
  refs?: string[];
}

/** In-app notifications. Nothing leaves the app; delivery is the inbox. */
export async function notify(db: Db, workspaceId: string, revision: number, seeds: NotificationSeed[]): Promise<string[]> {
  if (seeds.length === 0) return [];
  const rows = seeds.map((s) => ({
    id: newId("ntf"),
    workspaceId,
    recipientId: s.recipientId,
    kind: s.kind,
    title: s.title,
    body: s.body,
    refs: s.refs ?? [],
    createdRevision: revision,
  }));
  await db.insert(t.notifications).values(rows);
  return rows.map((r) => r.id);
}
