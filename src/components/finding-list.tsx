import { ResolveFindingForm } from "@/components/finding-forms";
import { RefInline } from "@/components/line-refs";
import { SeverityBadge } from "@/components/line-value";
import { dateOnly } from "@/lib/format";
import type { FindingView } from "@/server/queries/review";

/**
 * Findings for an area or a line, open ones first. The element id equals the
 * finding id so /review?finding=<id> and RefLinks can land on it; the one
 * named by the URL starts expanded.
 */
export function FindingList({
  findings,
  focusId,
  revision,
  canResolve,
  actorRole,
  compact = false,
}: {
  findings: FindingView[];
  focusId: string | null;
  revision: number;
  canResolve: boolean;
  actorRole: string;
  compact?: boolean;
}) {
  if (findings.length === 0) return <p className="text-sm text-stone-500">No findings here.</p>;
  return (
    <ul className="divide-y divide-stone-100">
      {findings.map((f) => {
        const expanded = f.id === focusId || (!compact && f.status === "open");
        return (
          <li key={f.id} id={f.id} className={`py-2 ${f.id === focusId ? "rounded bg-amber-50 px-2 ring-1 ring-amber-300" : ""}`}>
            <details open={expanded}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className={`font-medium ${f.status !== "open" ? "text-stone-500 line-through decoration-stone-300" : ""}`}>{f.title}</span>
                <SeverityBadge severity={f.severity} blocksFiling={f.blocksFiling && f.status === "open"} />
                <span className="text-xs text-stone-500">{f.originLabel}</span>
                {f.status !== "open" ? <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">{f.status}</span> : null}
                <span className="ml-auto text-xs text-stone-400">
                  {f.owner ? `owner ${f.owner.name}` : "no owner"}
                </span>
              </summary>
              <div className="mt-1 space-y-1 pl-1 text-sm">
                <p className="text-stone-700">{f.detail}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                  {f.code ? (
                    <span>
                      Code <span className="num">{f.code}</span>
                    </span>
                  ) : null}
                  <span>
                    Raised by {f.raisedBy?.name ?? "unknown"} at revision <span className="num">{f.createdRevision}</span> ({dateOnly(f.createdAt)})
                  </span>
                  {f.owner ? (
                    <span>
                      Owner {f.owner.name} ({f.owner.role})
                    </span>
                  ) : null}
                  <span>
                    Area {f.areaLabel}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-stone-500">References: </span>
                  <RefInline items={f.refs} />
                </div>
                {f.status !== "open" ? (
                  <p className="text-xs text-stone-600">
                    {f.status === "resolved" ? "Resolved" : "Dismissed"} by {f.resolvedBy?.name ?? "unknown"} at revision <span className="num">{f.resolvedRevision}</span>: {f.resolution}
                  </p>
                ) : (
                  <ResolveFindingForm findingId={f.id} revision={revision} canResolve={canResolve} actorRole={actorRole} />
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
