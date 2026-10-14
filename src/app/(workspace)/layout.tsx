import Link from "next/link";
import { Suspense } from "react";
import { actorsFromPacket, isAvailableAt } from "@/domain/policy";
import { dateOnly } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { LiveRefresh } from "@/components/live-refresh";
import { RoleSwitcher } from "@/components/role-switcher";
import { SearchBox } from "@/components/search-box";
import { NotificationBadge } from "@/components/notification-badge";
import { unreadCount } from "@/server/queries/people";

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/review", label: "Review" },
  { href: "/evidence", label: "Evidence" },
  { href: "/changes", label: "Changes" },
  { href: "/people", label: "People" },
  { href: "/filing", label: "Filing" },
  { href: "/firm", label: "Firm" },
];

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireSessionContext();
  const unread = ctx.actor.role === "client" ? 0 : await unreadCount(ctx);
  const personas = actorsFromPacket(ctx.packet.packet).map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    available: isAvailableAt(a, ctx.workspace.asOf),
    clearance: a.sensitiveClearance,
  }));
  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/overview" className="text-lg font-semibold tracking-tight">
            Trace
          </Link>
          <nav className="flex gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-stone-600 hover:text-stone-900">
                {n.label}
                {n.href === "/people" && unread > 0 ? <NotificationBadge count={unread} /> : null}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-4 text-xs text-stone-500">
            {ctx.actor.role !== "client" ? <SearchBox className="w-48" /> : null}
            <span title="Share this id to join from another browser">
              Workspace <span className="num font-medium text-stone-700">{ctx.workspace.id}</span>
            </span>
            <span title="Simulated business date; evidence is filtered by it">
              Clock <span className="num font-medium text-stone-700">{dateOnly(ctx.workspace.asOf)}</span>
            </span>
            <span title="Engine version used as the baseline">
              Return <span className="num font-medium text-stone-700">{ctx.workspace.activeVersion}</span>
            </span>
            <LiveRefresh revision={ctx.workspace.revision} />
            <Suspense fallback={null}>
              <RoleSwitcher personas={personas} currentId={ctx.actor.id} />
            </Suspense>
            <form action="/api/session/leave" method="post">
              <button type="submit" className="text-xs text-stone-500 underline hover:text-stone-800" title="Forget this browser session; the workspace is kept and can be joined again by id">
                Leave
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
