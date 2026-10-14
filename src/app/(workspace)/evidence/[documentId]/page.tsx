import Link from "next/link";
import { notFound } from "next/navigation";
import { LineStatusBadge, RecordStatusBadge } from "@/components/evidence-badges";
import { RefLink } from "@/components/ref-link";
import { SourcePage } from "@/components/source-page";
import { can } from "@/domain/policy";
import { dateOnly, dateTime, money } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { ANCHOR_STATE_LABELS, loadDocumentPage, type PageValue } from "@/server/queries/evidence";
import type { LineUse } from "@/server/queries/trace";
import { EvidenceScroll } from "../evidence-scroll";
import { EvidenceForms } from "./evidence-forms";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function DocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requireSessionContext();
  const { documentId } = await params;
  const sp = await searchParams;
  const pageParam = Number(one(sp.page) ?? "1");
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const selected = one(sp.ev) ?? null;
  const view = await loadDocumentPage(ctx, documentId, page, { selectedValue: selected });
  if (!view) notFound();
  const d = view.document;
  const pages = Array.from({ length: d.pageCount }, (_, i) => i + 1);

  return (
    <div className="space-y-5">
      <EvidenceScroll ids={selected ? [`hl-${selected}`, selected] : []} />
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs text-stone-500">
            <Link href="/evidence" className="hover:underline">
              Evidence
            </Link>{" "}
            / <span className="num">{d.id}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{d.title}</h1>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs text-stone-600 sm:grid-cols-[auto_1fr_auto_1fr]">
            <dt className="text-stone-400">Type</dt>
            <dd>{d.typeLabel}</dd>
            <dt className="text-stone-400">Issuer</dt>
            <dd>{d.issuer}</dd>
            <dt className="text-stone-400">Belongs to</dt>
            <dd>{d.belongsToLabel}</dd>
            <dt className="text-stone-400">Received</dt>
            <dd className="num">
              {dateTime(d.receivedAt)} by {d.uploadedBy}
            </dd>
            <dt className="text-stone-400">File</dt>
            <dd className="num">{d.fileName}</dd>
            <dt className="text-stone-400">Extraction</dt>
            <dd>
              {d.extractionStatus.replace(/_/g, " ")}, <span className="num">{d.extractionValues}</span> values
              {d.extractionReason ? <span className="text-stone-500">: {d.extractionReason}</span> : null}
            </dd>
            <dt className="text-stone-400">Review area</dt>
            <dd>
              <Link href={`/evidence?area=${d.area}`} className="hover:underline">
                {d.areaLabel}
              </Link>
            </dd>
            <dt className="text-stone-400">Return version</dt>
            <dd className="num">{view.version}</dd>
          </dl>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {d.markedCorrected ? <span className="rounded bg-emerald-100 px-2 py-0.5 text-emerald-800">marked CORRECTED by the issuer</span> : null}
            {d.supersededBy ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">
                Superseded in {view.version} by{" "}
                <Link href={`/evidence/${d.supersededBy.id}`} className="font-medium hover:underline">
                  {d.supersededBy.id} {d.supersededBy.title}
                </Link>
                ; the engine used the replacement instead of this document.
              </span>
            ) : null}
            {d.supersedes ? (
              <span className="rounded bg-stone-100 px-2 py-0.5 text-stone-700">
                Supersedes{" "}
                <Link href={`/evidence/${d.supersedes.id}`} className="font-medium hover:underline">
                  {d.supersedes.id}
                </Link>{" "}
                in {view.version}
              </span>
            ) : null}
          </div>
        </div>
        <nav className="text-xs">
          <div className="text-stone-500">Pages</div>
          <div className="mt-1 flex max-w-sm flex-wrap gap-1">
            {pages.map((p) => (
              <Link
                key={p}
                href={`/evidence/${d.id}?page=${p}`}
                className={`num rounded border px-1.5 py-0.5 ${p === view.page ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white hover:bg-stone-100"}`}
              >
                {p}
              </Link>
            ))}
          </div>
        </nav>
      </section>

      {!view.available ? (
        <section className="rounded-lg border border-stone-300 bg-stone-100 p-6 text-sm">
          <h2 className="font-medium">Not available at the replay clock</h2>
          <p className="mt-1 text-stone-700">
            This document arrives on <span className="num">{dateOnly(view.availableOn)}</span>; the workspace clock is <span className="num">{dateOnly(view.asOf)}</span>. Its pages
            cannot be viewed, cited or anchored until the clock passes the receipt date. Nothing from it was available to the engine at this version
            unless the version itself was computed after that date.
          </p>
        </section>
      ) : !view.pageExists ? (
        <section className="rounded-lg border border-stone-300 bg-stone-100 p-6 text-sm">
          <h2 className="font-medium">No such page</h2>
          <p className="mt-1 text-stone-700">
            {d.id} has {d.pageCount} page(s); page {view.page} does not exist in the packet.
          </p>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="space-y-5">
            <SourcePage
              documentId={d.id}
              page={view.page}
              segments={view.segments}
              selectedValue={view.selectedValue}
              valueLabels={Object.fromEntries(view.values.map((v) => [v.id, v.label]))}
              anchorLabels={Object.fromEntries(view.anchors.map((a) => [a.id, `${a.subjectRef} (${a.subjectLabel})`]))}
            />
            <Landed view={view} />
            <WorkpaperUses view={view} />
          </div>
          <div className="space-y-5">
            <ValuesPanel values={view.values} selected={view.selectedValue} documentId={d.id} page={view.page} />
            <AnchorsPanel view={view} />
            <EvidenceForms
              revision={ctx.workspace.revision}
              documentId={d.id}
              page={view.page}
              pageRef={view.pageRef}
              verificationTypes={view.verificationTypes}
              areas={view.areas}
              defaultArea={d.area}
              subjectSuggestions={view.subjectSuggestions}
              permissions={{ anchor: can(ctx.actor, "add_anchor"), verification: can(ctx.actor, "add_verification"), finding: can(ctx.actor, "raise_finding") }}
              actorName={ctx.actor.name}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ValuesPanel({ values, selected, documentId, page }: { values: PageValue[]; selected: string | null; documentId: string; page: number }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
        <h2 className="font-medium">Extracted values on this page</h2>
        <span className="num text-xs text-stone-500">{values.length}</span>
      </div>
      {values.length === 0 ? (
        <div className="p-4 text-sm">
          <p className="font-medium text-amber-900">Nothing was extracted from this page.</p>
          <p className="mt-1 text-xs text-stone-600">
            The pipeline read no values here, so nothing on it can have reached the return through the engine. If the page supports a line (for
            example a lot the broker printed only on a supplemental page), anchor the exact text with the form below and propose the change on the
            line.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-stone-100">
          {values.map((v) => (
            <li key={v.id} id={v.id} className={`px-4 py-2.5 text-sm ${selected === v.id ? "bg-orange-50 ring-2 ring-inset ring-orange-400" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <div>
                  <span className="font-medium">{v.label}</span>
                  <span className="num ml-2 text-xs text-stone-500">{v.field}</span>
                </div>
                <div className="num text-base">{v.display}</div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-600">
                <span className="num text-stone-400">{v.id}</span>
                <span>{v.valueType.replace(/_/g, " ")}</span>
                <span className="num">confidence {v.confidence.toFixed(2)}</span>
                <span>
                  read as <span className="num">&quot;{v.textAsRead}&quot;</span>
                </span>
                <AnchorStateBadge state={v.anchorState} occurrences={v.occurrences} />
                {selected === v.id ? (
                  <span className="text-orange-700">selected</span>
                ) : v.anchorState === "found" ? (
                  <Link href={`/evidence/${documentId}?page=${page}&ev=${v.id}`} className="text-blue-700 hover:underline">
                    show on page
                  </Link>
                ) : null}
              </div>
              {v.printedCandidate ? (
                <div className="mt-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-900">
                  The page prints <span className="num font-medium">{v.printedCandidate.printed}</span> after &quot;{v.printedCandidate.label}&quot;;
                  the pipeline read <span className="num font-medium">{v.textAsRead}</span>.{" "}
                  {v.printedCandidate.differs ? "The two differ: the return carries the extracted value, not what is printed." : "Same text, different formatting."}
                </div>
              ) : null}
              <div className="mt-1 text-xs">
                {v.usedBy.length ? (
                  <span className="text-stone-600">
                    used by{" "}
                    {v.usedBy.map((k, i) => (
                      <span key={k}>
                        {i > 0 ? ", " : ""}
                        <RefLink refId={k} />
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800">not used by the engine</span>
                )}
                <span className="num ml-3 text-stone-400" title="Synthetic position supplied by the pipeline; not used for highlighting">
                  box {v.position.x0.toFixed(2)},{v.position.y0.toFixed(2)} to {v.position.x1.toFixed(2)},{v.position.y1.toFixed(2)} (synthetic)
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AnchorStateBadge({ state, occurrences }: { state: PageValue["anchorState"]; occurrences: number }) {
  const tone = state === "found" ? "bg-yellow-100 text-yellow-900" : state === "not_found" ? "bg-rose-100 text-rose-800" : "bg-stone-100 text-stone-600";
  const text = state === "ambiguous" ? `no exact anchor on the page: printed ${occurrences} times` : state === "found" ? ANCHOR_STATE_LABELS.found : `no exact anchor on the page: ${ANCHOR_STATE_LABELS[state]}`;
  return <span className={`rounded px-1.5 py-0.5 ${tone}`}>{text}</span>;
}

function AnchorsPanel({ view }: { view: NonNullable<Awaited<ReturnType<typeof loadDocumentPage>>> }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
        <h2 className="font-medium">Manual anchors on this page</h2>
        <span className="num text-xs text-stone-500">{view.anchors.length}</span>
      </div>
      {view.anchors.length === 0 ? (
        <p className="p-4 text-xs text-stone-500">No reviewer has anchored text on this page yet.</p>
      ) : (
        <ul className="divide-y divide-stone-100 text-sm">
          {view.anchors.map((a) => (
            <li key={a.id} id={a.id} className="px-4 py-2.5">
              <div>
                <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-900">anchor</span>{" "}
                <span className="num">&quot;{a.textSpan}&quot;</span>
              </div>
              <div className="mt-1 text-xs text-stone-600">
                supports <RefLink refId={a.subjectRef} label={`${a.subjectRef}: ${a.subjectLabel}`} /> by {a.createdBy} at revision <span className="num">{a.createdRevision}</span>
                {a.note ? <span>; {a.note}</span> : null}
                {!a.located ? <span className="ml-2 text-rose-700">text no longer locatable on the page</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LineRow({ l }: { l: LineUse }) {
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="px-4 py-1.5">
        <RefLink refId={l.key} label={`${l.form} line ${l.line}`} className="num text-xs text-blue-700 hover:underline" />
        <div className="text-xs text-stone-700">{l.label}</div>
        {l.note ? <div className="text-xs text-stone-500">Engine note: {l.note}</div> : null}
      </td>
      <td className="num px-2 py-1.5 text-right">{typeof l.effective === "number" ? money(l.effective) : String(l.effective ?? "blank")}</td>
      <td className="px-2 py-1.5">
        <LineStatusBadge status={l.status} />
      </td>
      <td className="px-2 py-1.5 text-xs text-stone-500">
        {l.relation === "direct" ? (
          <span>
            via{" "}
            {l.via.map((v, i) => (
              <span key={v} className="num">
                {i > 0 ? ", " : ""}
                {v}
              </span>
            ))}
          </span>
        ) : (
          <span>transitive</span>
        )}
        <div className="text-stone-400">{l.rule}</div>
      </td>
    </tr>
  );
}

function Landed({ view }: { view: NonNullable<Awaited<ReturnType<typeof loadDocumentPage>>> }) {
  const d = view.document;
  const landed = view.landed;
  const otherVersions = Object.entries(landed.byVersion).filter(([v]) => v !== view.version);
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-4 py-2.5">
        <h2 className="font-medium">Where this page landed</h2>
        <p className="text-xs text-stone-500">
          Return lines in {view.version} whose sources include a value extracted from this page, then everything computed from those lines.
        </p>
      </div>
      {d.supersededBy ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          This document is superseded by {d.supersededBy.id} in {view.version}. Lines listed below cite values the engine read from this document before
          the replacement arrived, if any; current amounts come from {d.supersededBy.id}.
        </p>
      ) : null}
      {landed.engineNotes.length ? (
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs">
          <div className="text-stone-500">Engine&apos;s stated reason</div>
          {landed.engineNotes.map((n) => (
            <div key={n.key}>
              <RefLink refId={n.key} label={n.label} /> : {n.note}
            </div>
          ))}
        </div>
      ) : null}
      {landed.nothingLanded ? (
        <div className="px-4 py-3 text-sm">
          <p className="font-medium text-rose-900">Nothing from this page is used by the engine in {view.version}.</p>
          <p className="mt-1 text-xs text-stone-600">
            {view.values.length === 0
              ? "No values were extracted from this page, so the engine had nothing to use."
              : d.supersededBy
                ? "The engine used the superseding document instead."
                : landed.engineNotes.length
                  ? "See the engine's stated reason above."
                  : "The extracted values exist but no return line cites them. Either the engine ignored them deliberately or something is missing from the return; verify and raise a finding if a line should carry them."}
          </p>
          {otherVersions.length ? (
            <p className="mt-1 text-xs text-stone-600">
              In other versions:{" "}
              {otherVersions.map(([v, keys]) => (
                <span key={v}>
                  {v}: {keys.join(", ")}.{" "}
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="px-4 py-1.5 font-normal">Line</th>
                <th className="px-2 py-1.5 text-right font-normal">Effective value</th>
                <th className="px-2 py-1.5 font-normal">Status</th>
                <th className="px-2 py-1.5 font-normal">How</th>
              </tr>
            </thead>
            <tbody>
              {landed.direct.map((l) => (
                <LineRow key={l.key} l={l} />
              ))}
            </tbody>
          </table>
          {landed.transitive.length ? (
            <details className="border-t border-stone-200 px-4 py-2 text-sm">
              <summary className="cursor-pointer text-xs text-stone-600">
                {landed.transitive.length} line(s) downstream (transitive): {landed.transitive.slice(0, 6).map((l) => l.key).join(", ")}
                {landed.transitive.length > 6 ? ", ..." : ""}
              </summary>
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {landed.transitive.map((l) => (
                    <LineRow key={l.key} l={l} />
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
          {landed.unusedValues.length ? (
            <p className="border-t border-stone-200 px-4 py-2 text-xs text-stone-600">
              {landed.unusedValues.length} of {view.values.length} values on this page are not used by the engine:{" "}
              {landed.unusedValues.slice(0, 12).map((id, i) => (
                <span key={id}>
                  {i > 0 ? ", " : ""}
                  <Link href={`/evidence/${d.id}?page=${view.page}&ev=${id}`} className="num text-blue-700 hover:underline">
                    {id}
                  </Link>
                </span>
              ))}
              {landed.unusedValues.length > 12 ? ` and ${landed.unusedValues.length - 12} more` : ""}.
            </p>
          ) : null}
          {otherVersions.length ? (
            <p className="border-t border-stone-200 px-4 py-2 text-xs text-stone-500">
              Also cited in{" "}
              {otherVersions.map(([v, keys], i) => (
                <span key={v}>
                  {i > 0 ? "; " : ""}
                  {v}: {keys.length} line(s)
                </span>
              ))}
              .
            </p>
          ) : null}
          {landed.otherEngineUses.length ? (
            <p className="border-t border-stone-200 px-4 py-2 text-xs text-stone-500">
              Other engine uses:{" "}
              {landed.otherEngineUses.map((u, i) => (
                <span key={`${u.ref}-${i}`}>
                  {i > 0 ? "; " : ""}
                  <RefLink refId={u.ref} label={u.label} /> ({u.relation})
                </span>
              ))}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function WorkpaperUses({ view }: { view: NonNullable<Awaited<ReturnType<typeof loadDocumentPage>>> }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
        <h2 className="font-medium">Workpaper records citing this page</h2>
        <span className="num text-xs text-stone-500">{view.workpaper.length}</span>
      </div>
      {view.workpaper.length === 0 ? (
        <p className="p-4 text-xs text-stone-500">No adjustment, verification, anchor or finding cites this page or its values yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-4 py-1.5 font-normal">Record</th>
              <th className="px-2 py-1.5 font-normal">About</th>
              <th className="px-2 py-1.5 font-normal">Status</th>
              <th className="px-2 py-1.5 font-normal">Detail</th>
            </tr>
          </thead>
          <tbody>
            {view.workpaper.map((w) => (
              <tr key={w.ref} className="border-t border-stone-100 align-top">
                <td className="px-4 py-1.5">
                  <RefLink refId={w.ref} label={w.table} />
                  <div className="num text-xs text-stone-400">{w.id}</div>
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {w.table === "finding" ? w.subject : <RefLink refId={w.subject} label={`${w.subject}: ${w.subjectLabel}`} />}
                </td>
                <td className="px-2 py-1.5">
                  <RecordStatusBadge status={w.status} />
                </td>
                <td className="px-2 py-1.5 text-xs text-stone-600">
                  {w.detail}
                  <div className="text-stone-400">
                    by {w.actorId} at revision <span className="num">{w.createdRevision}</span>; cites {w.via.join(", ")}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
