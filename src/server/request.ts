import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { loadPacket } from "@/packet/load";
import { loadSessionContext, SESSION_COOKIE, type SessionContext } from "./context";

/** Session for the current request, from the cookie. */
export async function getSessionContext(): Promise<SessionContext | null> {
  const store = await cookies();
  const { db } = await getDb();
  return loadSessionContext(db, loadPacket(), store.get(SESSION_COOKIE)?.value);
}

/** Session or redirect to the landing page. */
export async function requireSessionContext(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/");
  return ctx;
}
