import Link from "next/link";
import { LineStatusBadge, RecordStatusBadge } from "@/components/evidence-badges";
import { RefLink } from "@/components/ref-link";
import { dateOnly, dateTime, money } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { loadClientItems, type ClientItem } from "@/server/queries/evidence";
import { EvidenceScroll } from "../evidence-scroll";

export const dynamic = "force-dynamic";

export default async function ClientEvidencePage() {
  const ctx = await requireSessionContext();
  const items = await loadClientItems(ctx);
  const count = (list: ClientItem[]) => `${list.filter((i) => i.available).length} of ${list.length} available`;
  return (
    <div className="space-y-6">
      <EvidenceScroll ids={[]} />
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/evidence" className="hover:underline">
            Evidence
          </Link>{" "}
          / Client
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Client answers, messages and call notes</h1>
        <p className="mt-1 text-sm text-stone-600">
          What the client told the firm, filtered by the replay clock <span className="num">{dateOnly(items.asOf)}</span>. Each item shows the return
          lines in {items.version} that cite it and the workpaper records that rely on it. Items dated after the clock are listed without content.
        </p>
      </section>

      <Section title="Questionnaire" subtitle={count(items.questionnaire)}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-4 py-1.5 font-normal">Id</th>
              <th className="px-2 py-1.5 font-normal">Question</th>
              <th className="px-2 py-1.5 font-normal">Answer</th>
              <th className="px-2 py-1.5 font-normal">Answered</th>
              <th className="px-2 py-1.5 font-normal">Cited by</th>
            </tr>
          </thead>
          <tbody>
            {items.questionnaire.map((q) => (
              <tr key={q.id} id={q.id} className={`border-t border-stone-100 align-top ${q.available ? "" : "text-stone-500"}`}>
                <td className="num px-4 py-1.5 text-xs">{q.id}</td>
                <td className="px-2 py-1.5">{q.title}</td>
                <td className="px-2 py-1.5">{q.available ? q.body : <Unavailable at={q.at} />}</td>
                <td className="px-2 py-1.5 text-xs">
                  {q.who}
                  <div className="num text-stone-400">{dateOnly(q.at)}</div>
                </td>
                <td className="px-2 py-1.5">
                  <Citations item={q} version={items.version} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Messages" subtitle={count(items.messages)}>
        <ul className="divide-y divide-stone-100 text-sm">
          {items.messages.map((m) => (
            <li key={m.id} id={m.id} className={`px-4 py-2.5 ${m.available ? "" : "text-stone-500"}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <span className="num">{m.id}</span>
                <span className="font-medium text-stone-700">{m.title}</span>
                <span className="num text-stone-400">{dateTime(m.at)}</span>
              </div>
              <div className="mt-1">{m.available ? m.body : <Unavailable at={m.at} />}</div>
              <div className="mt-1">
                <Citations item={m} version={items.version} />
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Call notes" subtitle={count(items.callNotes)}>
        <ul className="divide-y divide-stone-100 text-sm">
          {items.callNotes.map((c) => (
            <li key={c.id} id={c.id} className={`px-4 py-2.5 ${c.available ? "" : "text-stone-500"}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 text-xs">
                <span className="num">{c.id}</span>
                <span className="font-medium text-stone-700">{c.title}</span>
                <span className="num text-stone-400">{dateOnly(c.at)}</span>
              </div>
              {c.available ? (
                <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                  {c.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ol>
              ) : (
                <div className="mt-1">
                  <Unavailable at={c.at} />
                </div>
              )}
              <div className="mt-1">
                <Citations item={c} version={items.version} />
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
        <h2 className="font-medium">{title}</h2>
        <span className="text-xs text-stone-500">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function Unavailable({ at }: { at: string }) {
  return (
    <span className="rounded bg-stone-200 px-2 py-0.5 text-xs text-stone-700">
      arrives on <span className="num">{dateOnly(at)}</span>; content not available at the replay clock
    </span>
  );
}

function Citations({ item, version }: { item: ClientItem; version: string }) {
  const otherVersions = Object.entries(item.byVersion).filter(([v]) => v !== version);
  if (item.lines.length === 0 && item.workpaper.length === 0) {
    return (
      <span className="text-xs text-stone-400">
        {otherVersions.length
          ? `not cited in ${version}; cited in ${otherVersions.map(([v, keys]) => `${v} (${keys.join(", ")})`).join("; ")}`
          : "not cited by any return line or workpaper record"}
      </span>
    );
  }
  return (
    <div className="space-y-1 text-xs">
      {item.lines.map((l) => (
        <div key={l.key} className="flex flex-wrap items-center gap-x-2">
          <RefLink refId={l.key} label={`${l.form} line ${l.line}`} />
          <span className="text-stone-600">{l.label}</span>
          <span className="num">{typeof l.value === "number" ? money(l.value) : String(l.value ?? "blank")}</span>
          <LineStatusBadge status={l.status} />
        </div>
      ))}
      {item.workpaper.map((w) => (
        <div key={w.ref} className="flex flex-wrap items-center gap-x-2">
          <RefLink refId={w.ref} label={w.table} />
          <span className="text-stone-600">{w.table === "finding" ? w.subject : `${w.subject}: ${w.subjectLabel}`}</span>
          <RecordStatusBadge status={w.status} />
        </div>
      ))}
    </div>
  );
}
