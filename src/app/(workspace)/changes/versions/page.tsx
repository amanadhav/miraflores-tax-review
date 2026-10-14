import Link from "next/link";
import { Pager, withParams } from "@/components/changes-pager";
import { Value } from "@/components/changes-value";
import { CommandButton } from "@/components/command-client";
import { RefLink } from "@/components/ref-link";
import { dateOnly, dateTime, money } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { versionCompare, versionIds, type DiagnosticView, type LineChangeView } from "@/server/queries/changes";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function ChangeTable({ rows, emptyText }: { rows: LineChangeView[]; emptyText: string }) {
  if (rows.length === 0) return <p className="text-sm text-stone-500">{emptyText}</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs text-stone-500">
        <tr>
          <th className="px-3 py-2 font-normal">Line</th>
          <th className="px-3 py-2 font-normal">Change</th>
          <th className="px-3 py-2 font-normal">Old</th>
          <th className="px-3 py-2 font-normal">New</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.change}-${r.key}`} className="border-t border-stone-100 align-top">
            <td className="px-3 py-1.5">
              <RefLink refId={r.key} label={r.key} className="num text-sm text-blue-700 hover:underline" />
              <div className="text-xs text-stone-500">{r.label}</div>
            </td>
            <td className="px-3 py-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-xs ${
                  r.change === "added" ? "bg-emerald-100 text-emerald-800" : r.change === "removed" ? "bg-red-50 text-red-700" : "bg-amber-100 text-amber-800"
                }`}
              >
                {r.change}
              </span>
            </td>
            <td className="num px-3 py-1.5 text-stone-500">{r.change === "added" ? "" : <Value value={r.old} className="num" />}</td>
            <td className="num px-3 py-1.5">{r.change === "removed" ? "" : <Value value={r.new} className="num" />}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DiagnosticList({ items, emptyText }: { items: DiagnosticView[]; emptyText: string }) {
  if (items.length === 0) return <p className="text-sm text-stone-500">{emptyText}</p>;
  return (
    <ul className="space-y-2">
      {items.map((d) => (
        <li key={d.code} className="text-sm">
          <span className="num font-medium">{d.code}</span>
          <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${d.severity === "warning" ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{d.severity}</span>
          <p className="text-stone-700">{d.message}</p>
          {d.refs.length ? (
            <p className="text-xs">
              {d.refs.map((r, i) => (
                <span key={r.ref}>
                  {i > 0 ? ", " : ""}
                  <RefLink refId={r.ref} label={r.ref} />
                </span>
              ))}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default async function VersionsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const ids = versionIds(ctx);
  const pick = (v: string | undefined, fallback: string) => (v && ids.includes(v) ? v : fallback);
  const selected = pick(one(sp.version), pick(one(sp.to), ctx.workspace.activeVersion));
  const to = pick(one(sp.to), selected);
  const from = pick(one(sp.from), ids[Math.max(0, ids.indexOf(to) - 1)]);
  const page = Number(one(sp.page) ?? 1) || 1;
  const cmp = await versionCompare(ctx, from, to, { selected, page });
  const sel = cmp.selected;
  const revision = ctx.workspace.revision;
  const diffHref = (p: number) => withParams("/changes/versions", { version: selected, from, to, page: p }, "diff");

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Engine versions</h1>
        <p className="mt-1 text-sm text-stone-600">
          The engine computed the return three times. Each version is an immutable baseline; the workpaper&apos;s changes sit on top of one of them. The
          workspace baseline is <span className="num font-medium">{cmp.activeVersion}</span>.
        </p>
        <p className="mt-2 rounded border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600">
          Engine version and evidence time are separate. Selecting a version as the baseline does not move the replay clock, which stays at{" "}
          <span className="num">{dateTime(cmp.asOf)}</span>; the clock moves only from the{" "}
          <Link href="/changes/timeline" className="text-blue-700 hover:underline">
            timeline
          </Link>
          . Switching the baseline never touches an adjustment: proposals made against another version are flagged as needing rebase in the ledger
          and cannot be decided until they are redone against the new baseline.
        </p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">All versions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-3 py-2 font-normal">Version</th>
                <th className="px-3 py-2 font-normal">Computed</th>
                <th className="px-3 py-2 font-normal">Trigger</th>
                <th className="px-3 py-2 font-normal">Docs used</th>
                <th className="px-3 py-2 font-normal">Superseded</th>
                <th className="px-3 py-2 font-normal">Fed AGI</th>
                <th className="px-3 py-2 font-normal">Fed total tax</th>
                <th className="px-3 py-2 font-normal">Fed balance due</th>
                <th className="px-3 py-2 font-normal">CA AGI</th>
                <th className="px-3 py-2 font-normal">CA total tax</th>
                <th className="px-3 py-2 font-normal">CA balance due</th>
                <th className="px-3 py-2 font-normal">Diagnostics</th>
                <th className="px-3 py-2 font-normal">Baseline</th>
              </tr>
            </thead>
            <tbody>
              {cmp.versions.map((v) => (
                <tr key={v.version} className={`border-t border-stone-100 align-top ${v.isSelected ? "bg-stone-50" : ""}`}>
                  <td className="px-3 py-2">
                    <Link href={withParams("/changes/versions", { version: v.version })} className="num font-medium text-blue-700 hover:underline">
                      {v.version}
                    </Link>
                    {v.isSelected ? <div className="text-xs text-stone-500">selected</div> : null}
                  </td>
                  <td className="num px-3 py-2">{dateTime(v.computedAt)}</td>
                  <td className="max-w-xs px-3 py-2 text-xs text-stone-600">{v.trigger}</td>
                  <td className="num px-3 py-2">{v.documentsUsed}</td>
                  <td className="num px-3 py-2">{v.documentsSuperseded}</td>
                  <td className="num px-3 py-2">{money(v.federal.agi)}</td>
                  <td className="num px-3 py-2">{money(v.federal.total_tax)}</td>
                  <td className="num px-3 py-2">{money(v.federal.balance_due)}</td>
                  <td className="num px-3 py-2">{money(v.california.ca_agi)}</td>
                  <td className="num px-3 py-2">{money(v.california.total_tax)}</td>
                  <td className="num px-3 py-2">{money(v.california.balance_due)}</td>
                  <td className="num px-3 py-2">{v.diagnosticsCount}</td>
                  <td className="px-3 py-2">
                    {v.isActive ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">current baseline</span>
                    ) : (
                      <CommandButton
                        revision={revision}
                        type="set_version"
                        payload={{ version: v.version }}
                        confirm={`Make ${v.version} (computed ${dateOnly(v.computedAt)}) the baseline? The replay clock stays at ${dateOnly(cmp.asOf)}. Proposals made against ${cmp.activeVersion} will be flagged as needing rebase; none is changed.`}
                      >
                        Use this version as the baseline
                      </CommandButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-5 py-3 text-xs text-stone-500">
          Federal and California figures are the engine&apos;s own summary numbers for each version. A negative California balance due is an overpayment.
        </p>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-3">
            <h2 className="font-medium">
              What the engine changed in <span className="num">{sel.version}</span>
              {sel.previousVersion ? (
                <>
                  {" "}
                  from <span className="num">{sel.previousVersion}</span>
                </>
              ) : null}
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Computed <span className="num">{dateTime(sel.computedAt)}</span>: {sel.trigger}
            </p>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <ChangeTable rows={sel.changesFromPrevious} emptyText={sel.previousVersion ? "The engine reported no line changes." : "First run: there is no previous version to compare with."} />
          </div>
          <p className="px-5 py-2 text-xs text-stone-500">
            <span className="num">{sel.changesFromPrevious.length}</span> line change(s) as reported by the engine in changes_from_previous.
          </p>
        </div>

        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-200 px-5 py-3">
            <h2 className="font-medium">
              Diagnostics in <span className="num">{sel.version}</span>
            </h2>
          </div>
          <div className="space-y-5 px-5 py-4">
            {sel.previousVersion ? (
              <div>
                <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">
                  Disappeared since {sel.previousVersion} ({sel.resolvedDiagnostics.length})
                </h3>
                <div className="mt-2">
                  <DiagnosticList items={sel.resolvedDiagnostics} emptyText={`Every ${sel.previousVersion} diagnostic is still present.`} />
                </div>
              </div>
            ) : null}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">
                New in {sel.version} ({sel.newDiagnostics.length})
              </h3>
              <div className="mt-2">
                <DiagnosticList items={sel.newDiagnostics} emptyText={sel.previousVersion ? "No new diagnostics." : "First run: every diagnostic is new."} />
              </div>
            </div>
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-stone-500">All diagnostics ({sel.diagnostics.length})</h3>
              <div className="mt-2">
                <DiagnosticList items={sel.diagnostics} emptyText="No diagnostics." />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="diff" className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 px-5 py-3">
          <div>
            <h2 className="font-medium">
              Line diff <span className="num">{cmp.diff.from}</span> to <span className="num">{cmp.diff.to}</span>
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Computed from the packet lines, value by value: <span className="num">{cmp.diff.added}</span> added, <span className="num">{cmp.diff.removed}</span> removed,{" "}
              <span className="num">{cmp.diff.changed}</span> changed.
            </p>
          </div>
          <form method="get" action="/changes/versions#diff" className="flex flex-wrap items-end gap-2 text-sm">
            <input type="hidden" name="version" value={selected} />
            <label className="flex flex-col gap-1 text-xs text-stone-500">
              From
              <select name="from" defaultValue={from} className="rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900">
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-stone-500">
              To
              <select name="to" defaultValue={to} className="rounded border border-stone-300 bg-white px-2 py-1 text-sm text-stone-900">
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded border border-stone-300 bg-white px-2 py-1 text-xs hover:bg-stone-100">
              Compare
            </button>
          </form>
        </div>
        <div className="space-y-3 px-2 py-3">
          <div className="px-3">
            <Pager page={cmp.diff.page} pageCount={cmp.diff.pageCount} total={cmp.diff.total} pageSize={cmp.diff.pageSize} noun="Lines" hrefFor={diffHref} />
          </div>
          <ChangeTable rows={cmp.diff.rows} emptyText={from === to ? "Same version on both sides: nothing to compare." : "No line differs between these versions."} />
          <div className="px-3">
            <Pager page={cmp.diff.page} pageCount={cmp.diff.pageCount} total={cmp.diff.total} pageSize={cmp.diff.pageSize} noun="Lines" hrefFor={diffHref} />
          </div>
        </div>
      </section>
    </div>
  );
}
