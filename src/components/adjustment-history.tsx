import Link from "next/link";
import { AdjustmentActions } from "@/components/adjustment-actions";
import { RefInline } from "@/components/line-refs";
import { AdjustmentStatusBadge, formatLineValue } from "@/components/line-value";
import { dateOnly, signed } from "@/lib/format";
import type { AdjustmentView } from "@/server/queries/review";

function AdjLink({ id, prefix }: { id: string; prefix: string }) {
  return (
    <span>
      {prefix}{" "}
      <Link href={`#${id}`} className="num text-blue-700 hover:underline">
        {id}
      </Link>
    </span>
  );
}

/**
 * Every adjustment on a line, in the order proposed. Nothing is hidden:
 * rejected, superseded and reverted entries stay with their decisions.
 */
export function AdjustmentHistory({ items, revision }: { items: AdjustmentView[]; revision: number }) {
  if (items.length === 0) return <p className="text-sm text-stone-500">No adjustments have been proposed on this line.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => (
        <li key={a.id} id={a.id} className="rounded border border-stone-200 p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <AdjustmentStatusBadge status={a.status} />
            <span className="font-medium capitalize">{a.kind} change</span>
            {a.kind === "value" ? (
              <span className="num">
                {formatLineValue(a.priorValue)} to {formatLineValue(a.proposedValue)}
              </span>
            ) : a.kind === "label" ? (
              <span className="text-stone-700">
                &quot;{a.priorLabel}&quot; to &quot;{a.proposedLabel}&quot;
              </span>
            ) : (
              <span className="text-stone-700">evidence links only</span>
            )}
            {a.requiresPartner ? <span className="rounded border border-amber-300 px-1.5 py-0.5 text-xs text-amber-800">partner approval required</span> : null}
            <span className="ml-auto num text-xs text-stone-400">{a.id}</span>
          </div>
          <p className="mt-1 text-stone-700">{a.reason}</p>
          <div className="mt-1 text-xs">
            <span className="text-stone-500">Evidence: </span>
            <RefInline items={a.evidenceRefs} />
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
            <dt className="text-stone-500">Category</dt>
            <dd>{a.categoryLabel ?? "none"}{a.caSource ? " (California-source rate)" : ""}</dd>
            <dt className="text-stone-500">Measure change</dt>
            <dd className="num">{a.measureDelta === null ? "n/a" : signed(a.measureDelta)}</dd>
            <dt className="text-stone-500">Est. federal tax</dt>
            <dd className="num">{signed(a.effectFederal)}</dd>
            <dt className="text-stone-500">Est. California tax</dt>
            <dd className="num">{signed(a.effectCalifornia)}</dd>
            <dt className="text-stone-500">Federal balance due</dt>
            <dd className="num">{signed(a.balanceFederal)}</dd>
            <dt className="text-stone-500">California balance due</dt>
            <dd className="num">{signed(a.balanceCalifornia)}</dd>
            <dt className="text-stone-500">Effect status</dt>
            <dd>{a.effectStatus}</dd>
            <dt className="text-stone-500">Basis</dt>
            <dd className="sm:col-span-3">{a.effectBasis ?? "none recorded"}</dd>
          </dl>
          {a.limitations.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-stone-600">
              {a.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1 text-xs text-stone-500">
            Estimates at the supplied per-dollar rates; no corrected final tax is claimed.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-stone-500">
            <span>
              Proposed by {a.author.name} ({a.author.role}) at revision <span className="num">{a.createdRevision}</span>, {dateOnly(a.createdAt)}
            </span>
            {a.decidedBy ? (
              <span>
                {a.status === "rejected" ? "Rejected" : "Accepted"} by {a.decidedBy.name} ({a.decidedBy.role}) at revision <span className="num">{a.decidedRevision}</span>
                {a.decisionNote ? `: ${a.decisionNote}` : ""}
              </span>
            ) : null}
            {a.supersedesId ? <AdjLink prefix="Supersedes" id={a.supersedesId} /> : null}
            {a.supersededById ? <AdjLink prefix="Superseded by" id={a.supersededById} /> : null}
            {a.revertsId ? <AdjLink prefix="Reverts" id={a.revertsId} /> : null}
            {a.revertedById ? <AdjLink prefix="Reverted by" id={a.revertedById} /> : null}
          </div>
          {a.status === "proposed" || a.status === "accepted" ? (
            <div className="mt-2">
              <AdjustmentActions adjustmentId={a.id} status={a.status} revision={revision} canDecide={a.canDecide} canUndo={a.canUndo} decideWarning={a.decideWarning} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
