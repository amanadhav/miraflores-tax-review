import { PeopleNav } from "@/components/people-nav";
import { unreadCount } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/** The People section: requests, tasks, inbox and time. Staff only; a client sees a short refusal. */
export default async function PeopleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSessionContext();
  if (ctx.actor.role === "client") {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <p className="text-sm text-stone-600">This section is for firm staff. Your requests and approvals are on the client page.</p>
      </div>
    );
  }
  const unread = await unreadCount(ctx);
  return (
    <div className="space-y-6">
      <PeopleNav unread={unread} />
      {children}
    </div>
  );
}
