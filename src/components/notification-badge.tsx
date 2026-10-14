"use client";

import Link from "next/link";

/**
 * Unread notification count for the current actor. The number comes from the
 * server (unreadCount in src/server/queries/people.ts); this only draws it.
 * Renders nothing when there is nothing unread. Pass href={null} to draw the
 * pill without its own link (for example inside another link).
 */
export function NotificationBadge({ count, href = "/people/inbox", className }: { count: number; href?: string | null; className?: string }) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const text = count > 99 ? "99+" : String(count);
  const pill = (
    <span
      className={className ?? "num inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white"}
      title={`${count} unread notification${count === 1 ? "" : "s"}`}
      aria-label={`${count} unread notification${count === 1 ? "" : "s"}`}
    >
      {text}
    </span>
  );
  if (!href) return pill;
  return (
    <Link href={href} className="inline-flex items-center">
      {pill}
    </Link>
  );
}
