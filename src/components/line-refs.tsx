import { RefLink } from "@/components/ref-link";
import { dateOnly } from "@/lib/format";
import type { RefView } from "@/server/queries/review";

/**
 * One resolved reference: a link with its plain label, plus an explicit
 * unresolved or not-yet-available marker so missing evidence is never silent.
 */
export function RefBadge({ item, showRef = true }: { item: RefView; showRef?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <RefLink refId={item.ref} label={item.label} className={`text-xs hover:underline ${item.found ? "text-blue-700" : "text-red-700"}`} />
      {showRef ? <span className="num text-[11px] text-stone-400">{item.ref}</span> : null}
      {!item.found ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-800">unresolved</span> : null}
      {item.found && !item.available ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800" title={`Arrives ${dateOnly(item.availableAt)}; not usable at the current replay clock`}>
          arrives {dateOnly(item.availableAt)}
        </span>
      ) : null}
    </span>
  );
}

export function RefList({ items, empty = "none", showRef = true }: { items: RefView[]; empty?: string; showRef?: boolean }) {
  if (items.length === 0) return <span className="text-xs text-stone-400">{empty}</span>;
  return (
    <ul className="space-y-0.5">
      {items.map((r) => (
        <li key={r.ref}>
          <RefBadge item={r} showRef={showRef} />
        </li>
      ))}
    </ul>
  );
}

/** Compact inline list for table cells. */
export function RefInline({ items }: { items: RefView[] }) {
  if (items.length === 0) return <span className="text-xs text-stone-400">none</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-2 gap-y-0.5">
      {items.map((r) => (
        <RefBadge key={r.ref} item={r} showRef={false} />
      ))}
    </span>
  );
}
