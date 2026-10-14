"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/changes", label: "Since you last looked and ledger" },
  { href: "/changes/versions", label: "Versions" },
  { href: "/changes/whatif", label: "What-ifs" },
  { href: "/changes/timeline", label: "Timeline" },
];

/** Sub-navigation for the Changes section; plain links, no state of its own. */
export function ChangesNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-stone-200 text-sm" aria-label="Changes section">
      {ITEMS.map((item) => {
        const active = item.href === "/changes" ? pathname === "/changes" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`-mb-px border-b-2 px-3 py-2 ${active ? "border-stone-800 font-medium text-stone-900" : "border-transparent text-stone-600 hover:text-stone-900"}`}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
