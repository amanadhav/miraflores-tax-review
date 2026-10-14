"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NotificationBadge } from "@/components/notification-badge";

const ITEMS = [
  { href: "/people/requests", label: "Requests" },
  { href: "/people/tasks", label: "Tasks" },
  { href: "/people/inbox", label: "Inbox" },
  { href: "/people/time", label: "Time" },
];

/** Sub-navigation for the People section; plain links, the unread count comes from the server. */
export function PeopleNav({ unread }: { unread: number }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-stone-200 text-sm" aria-label="People section">
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 ${active ? "border-stone-800 font-medium text-stone-900" : "border-transparent text-stone-600 hover:text-stone-900"}`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
            {item.href === "/people/inbox" ? <NotificationBadge count={unread} href={null} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
