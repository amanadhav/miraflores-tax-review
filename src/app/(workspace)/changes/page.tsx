import Link from "next/link";
import { AuditEventList } from "@/components/audit-event-list";
import { MarkSeenButton } from "@/components/changes-mark-seen";
import { Pager, withParams } from "@/components/changes-pager";
import { Value } from "@/components/changes-value";
import { RefLink } from "@/components/ref-link";
import { dateTime, signed } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { auditPage, ledger, sinceLastLooked, type LedgerRow } from "@/server/queries/changes";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const MAX_SINCE_GROUPS = 60;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="num text-lg font-medium">{value}</div>
      {hint ? <div className="text-xs text-stone-500">{hint}</div> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "accepted"
      ? "bg-emerald-100 text-emerald-800"
      : status === "proposed"
        ? "bg-amber-100 text-amber-800"
        : status === "rejected"
          ? "bg-red-50 text-red-700"
          : "bg-stone-100 text-stone-600";
  return <span className={`rounded px-1.5 py-0.5 text-xs ${tone}`}>{status}</span>;
}

function effectText(value: number | null): string {
  return value === null ? "unknown" : signed(value);
}

function LedgerRowView({ row }: { row: LedgerRow }) {
  const inactive = row.status === "superseded" || row.status === "reverted" || row.status === "rejected";
  return (
    <>
      <tr id={row.id} className={`border-t border-stone-200 align-top ${inactive ? "text-stone-500" : ""}`}>
        <td className="px-3 py-2">
          <RefLink refId={row.targetRef} label={row.targetRef} className="num text-sm text-blue-700 hover:underline" />
          <div className="text-xs text-stone-500">{row.targetLabel}</div>
          <div className="mt-1 text-xs text-stone-500">
            {row.areaLabel}, {row.kind} change, against <span className="num">{row.baselineVersion}</span>
          </div>
          <div className="num mt-1 text-[11px] text-stone-400">{row.id}</div>
        </td>
        <td className="px-3 py-2">
          {row.kind === "label" ? (
            <div className="text-sm">
              <span className="text-stone-500">{row.priorLabel ?? "blank"}</span> to <span className="font-medium">{row.proposedLabel ?? "blank"}</span>
            </div>
          ) : row.kind === "value" ? (
            <div className="text-sm">
              <Value value={row.priorValue} className="num text-stone-500" /> to <Value value={row.proposedValue} className="num font-medium" />
            </div>
          ) : (
            <div className="text-sm">evidence links only; value unchanged</div>
          )}
          {row.categoryLabel ? <div className="mt-1 text-xs text-stone-500">{row.categoryLabel}</div> : null}
          {row.measureDelta !== null && row.category !== "none" ? (
            <div className="text-xs text-stone-500">
              measure change <span className="num">{signed(row.measureDelta)}</span>
              {row.caSource ? ", California-source" : ""}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2">
          <p className="text-sm">{row.reason}</p>
          <ul className="mt-1 space-y-0.5">
            {row.evidence.map((e) => (
              <li key={e.ref} className="text-xs">
                <RefLink refId={e.ref} label={e.ref} />
                <span className={`ml-1 ${e.found ? "text-stone-500" : "text-red-600"}`}>{e.label}</span>
              </li>
            ))}
          </ul>
        </td>
        <td className="px-3 py-2 text-xs">
          <div>
            federal tax <span className="num">{effectText(row.effectFederal)}</span>
          </div>
          <div>
            California tax <span className="num">{effectText(row.effectCalifornia)}</span>
          </div>
          <div>
            federal balance <span className="num">{effectText(row.balanceFederal)}</span>
          </div>
          <div>
            California balance <span className="num">{effectText(row.balanceCalifornia)}</span>
          </div>
          <div className="mt-1 text-stone-500">
            {row.effectStatus.replace(/_/g, " ")}
            {row.requiresPartner ? <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-amber-800">partner required</span> : null}
          </div>
        </td>
        <td className="px-3 py-2 text-xs">
          <div>
            <span className="font-medium">{row.authorName}</span> proposed at rev <span className="num">{row.createdRevision}</span>
          </div>
          <div className="text-stone-500">
            <span className="num">{dateTime(row.createdAt)}</span>
          </div>
          {row.deciderName ? (
            <div className="mt-1">
              <span className="font-medium">{row.deciderName}</span> decided at rev <span className="num">{row.decidedRevision}</span>
              <div className="text-stone-500">
                <span className="num">{dateTime(row.decidedAt)}</span>
              </div>
            </div>
          ) : (
            <div className="mt-1 text-stone-500">awaiting decision</div>
          )}
          {row.decisionNote ? <div className="mt-1 text-stone-600">note: {row.decisionNote}</div> : null}
        </td>
        <td className="px-3 py-2 text-xs">
          <StatusBadge status={row.status} />
          {row.needsRebase && (row.status === "proposed" || row.status === "accepted") ? (
            <div className="mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-800" title="Proposed against a different engine version than the workspace baseline">
              needs rebase: made against {row.baselineVersion}
            </div>
          ) : null}
          {row.supersedesId ? (
            <div className="mt-1">
              supersedes <RefLink refId={`adjustment:${row.supersedesId}`} label={row.supersedesId} />
            </div>
          ) : null}
          {row.supersededById ? (
            <div className="mt-1">
              superseded by <RefLink refId={`adjustment:${row.supersededById}`} label={row.supersededById} />
            </div>
          ) : null}
          {row.revertsId ? (
            <div className="mt-1">
              reverts <RefLink refId={`adjustment:${row.revertsId}`} label={row.revertsId} />
            </div>
          ) : null}
          {row.revertedById ? (
            <div className="mt-1">
              reverted by <RefLink refId={`adjustment:${row.revertedById}`} label={row.revertedById} />
            </div>
          ) : null}
        </td>
      </tr>
      <tr className={`align-top ${inactive ? "text-stone-400" : "text-stone-500"}`}>
        <td colSpan={6} className="px-3 pb-3 text-xs">
          {row.effectBasis ? <span>Basis: {row.effectBasis}</span> : null}
          {row.limitations.length ? <span> Limitations: {row.limitations.join(" ")}</span> : null}
        </td>
      </tr>
    </>
  );
}

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const filters = { actor: one(sp.actor), area: one(sp.area), action: one(sp.action) };
  const page = Number(one(sp.page) ?? 1) || 1;
  const since = await sinceLastLooked(ctx);
  const book = await ledger(ctx);
  const audit = await auditPage(ctx, filters, page);
  const shownGroups = since.groups.slice(0, MAX_SINCE_GROUPS);
  const counts = book.counts;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Changes</h1>
        <p className="mt-1 text-sm text-stone-600">
          Every adjustment keeps the original value, who proposed and decided it, why, and its estimated tax effect. Workspace{" "}
          <span className="num">{ctx.workspace.id}</span>, baseline <span className="num">{book.activeVersion}</span>, saved revision{" "}
          <span className="num">{ctx.workspace.revision}</span>.
        </p>
      </section>

      <section id="since" className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Since you last looked</h2>
          <MarkSeenButton revision={since.currentRevision} />
        </div>
        <p className="mt-1 text-xs text-stone-500">
          Your seen cursor ({ctx.actor.name}):{" "}
          {since.cursor === null ? (
            "none yet, so everything is listed"
          ) : (
            <>
              revision <span className="num">{since.cursor}</span>
            </>
          )}
          . Saved revision now <span className="num">{since.currentRevision}</span>. The cursor is a per-person revision kept on the server; it never
          depends on this browser&apos;s clock.
        </p>
        {since.groups.length === 0 ? (
          <p className="mt-3 text-sm text-stone-600">
            Nothing has changed since revision <span className="num">{since.cursor}</span>.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {shownGroups.map((g) => (
              <div key={g.revision}>
                <h3 className="text-xs font-medium text-stone-500">
                  Revision <span className="num">{g.revision}</span>
                </h3>
                <AuditEventList events={g.events} showRevision={false} />
              </div>
            ))}
            {since.groups.length > shownGroups.length ? (
              <p className="text-xs text-stone-500">
                {since.groups.length - shownGroups.length} more revision(s) not shown here; the full audit timeline below has everything.
              </p>
            ) : null}
          </div>
        )}
      </section>

      <section id="ledger" className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Change ledger</h2>
          <span className="text-xs text-stone-500">
            all {book.rows.length} adjustment(s), every status, oldest first
          </span>
        </div>
        <div className="grid gap-4 px-5 py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Accepted changes"
            value={String(book.net.accepted)}
            hint={`${counts.proposed ?? 0} proposed, ${counts.rejected ?? 0} rejected, ${counts.superseded ?? 0} superseded, ${counts.reverted ?? 0} reverted`}
          />
          <Stat label="Net estimated federal tax effect" value={signed(book.net.federal)} hint={`at ${book.net.ratesVersion} supplied rates`} />
          <Stat label="Net estimated California tax effect" value={signed(book.net.california)} hint={`at ${book.net.ratesVersion} supplied rates`} />
          <Stat label="Federal balance due effect" value={signed(book.net.balanceFederal)} />
          <Stat label="California balance due effect" value={signed(book.net.balanceCalifornia)} />
          <Stat label="Need rebase" value={String(book.needsRebaseCount)} hint={`made against a version other than ${book.activeVersion}`} />
        </div>
        <p className="px-5 pb-4 text-xs text-stone-500">
          These are estimates at the version&apos;s supplied per-dollar rates, summed over active accepted changes only; superseded and reverted rows are
          excluded by their status. Interactions between changes are not recomputed and no exact combined total exists.
          {book.net.unknownCount > 0 ? ` ${book.net.unknownCount} accepted change(s) have an unknown effect and add nothing to the sums.` : ""} The
          engine cannot be rerun here; no corrected final tax is claimed.
        </p>
        {book.rows.length === 0 ? (
          <p className="border-t border-stone-200 px-5 py-4 text-sm text-stone-600">
            No adjustments yet. Propose one from a return line under <Link href="/review" className="text-blue-700 hover:underline">Review</Link>.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="text-left text-xs text-stone-500">
                <tr>
                  <th className="px-3 py-2 font-normal">Line</th>
                  <th className="px-3 py-2 font-normal">Change</th>
                  <th className="px-3 py-2 font-normal">Reason and evidence</th>
                  <th className="px-3 py-2 font-normal">Estimated effect</th>
                  <th className="px-3 py-2 font-normal">Who</th>
                  <th className="px-3 py-2 font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {book.rows.map((row) => (
                  <LedgerRowView key={row.id} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section id="audit" className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">Full audit timeline</h2>
          <span className="text-xs text-stone-500">
            newest first, <span className="num">{audit.total}</span> event(s) match
          </span>
        </div>
        <form method="get" action="/changes#audit" className="flex flex-wrap items-end gap-3 border-b border-stone-100 px-5 py-3 text-sm">
          <label className="flex flex-col gap-1 text-xs text-stone-500">
            Person
            <select name="actor" defaultValue={audit.filters.actor ?? ""} className="rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900">
              <option value="">anyone</option>
              {audit.options.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-500">
            Area
            <select name="area" defaultValue={audit.filters.area ?? ""} className="rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900">
              <option value="">any area</option>
              {audit.options.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-500">
            Action
            <select name="action" defaultValue={audit.filters.action ?? ""} className="rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900">
              <option value="">any action</option>
              {audit.options.actions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100">
            Apply filters
          </button>
          <Link href="/changes#audit" className="text-xs text-blue-700 hover:underline">
            clear
          </Link>
        </form>
        <div className="space-y-3 px-5 py-3">
          <Pager
            page={audit.page}
            pageCount={audit.pageCount}
            total={audit.total}
            pageSize={audit.pageSize}
            noun="Events"
            hrefFor={(p) => withParams("/changes", { ...audit.filters, page: p }, "audit")}
          />
          <AuditEventList events={audit.events} emptyText="No events match these filters." />
          <Pager
            page={audit.page}
            pageCount={audit.pageCount}
            total={audit.total}
            pageSize={audit.pageSize}
            noun="Events"
            hrefFor={(p) => withParams("/changes", { ...audit.filters, page: p }, "audit")}
          />
        </div>
      </section>
    </div>
  );
}
