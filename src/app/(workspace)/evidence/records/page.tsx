import Link from "next/link";
import { RefLink } from "@/components/ref-link";
import { dateOnly, dateTime, money } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { loadRecords } from "@/server/queries/evidence";
import { EvidenceScroll } from "../evidence-scroll";

export const dynamic = "force-dynamic";

function list(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return (Array.isArray(v) ? v : [v]).map((s) => s.trim()).filter(Boolean);
}

export default async function RecordsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireSessionContext();
  const sp = await searchParams;
  const pointers = list(sp.pointer);
  const r = await loadRecords(ctx, pointers);
  const hit = new Set(pointers);
  const mark = (ref: string) => (hit.has(ref) ? "bg-orange-50 ring-2 ring-inset ring-orange-400" : "");

  return (
    <div className="space-y-6">
      <EvidenceScroll ids={pointers} />
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/evidence" className="hover:underline">
            Evidence
          </Link>{" "}
          / Records
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Prior years, agency, household and engine records</h1>
        <p className="mt-1 text-sm text-stone-600">
          Structured records the pipeline supplied alongside the documents. Agency snapshots, notices and e-file rows appear only when they exist at the
          replay clock <span className="num">{dateOnly(r.asOf)}</span>; later ones are listed as future replay previews without their payload. Unknown
          values stay unknown; nothing here is ever filled in with zero.
        </p>
        <nav className="mt-2 flex flex-wrap gap-3 text-xs">
          {[
            ["prior-return", "2024 return"],
            ["prior-workpaper", "Prior preparer memo"],
            ["assets", "Assets"],
            ["basis", "Basis"],
            ["carryovers", "Carryovers"],
            ["agency", "Agency records"],
            ["household", "Household"],
            ["engine", "Engine parameters and rules"],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="text-blue-700 hover:underline">
              {label}
            </a>
          ))}
        </nav>
      </section>

      {r.pointers.length ? (
        <section className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm">
          <h2 className="font-medium text-orange-900">Pointed records</h2>
          <ul className="mt-1 space-y-1">
            {r.pointers.map((p) => (
              <li key={p.ref}>
                <a href={`#${p.ref}`} className="num text-xs text-blue-700 hover:underline">
                  {p.ref}
                </a>{" "}
                <span className="text-stone-700">{p.label}</span>
                {p.found ? (
                  p.display ? <span className="num ml-2 text-xs text-stone-600">{p.display}</span> : null
                ) : (
                  <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-xs text-rose-800">does not resolve in the packet</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section id="prior-return" title="2024 return as filed" subtitle={`${r.priorReturn.preparedBy}; filed ${r.priorReturn.filed}; ${r.priorReturn.residency}`}>
        <p className="px-4 pt-2 text-xs text-stone-500">
          Source document <RefLink refId={r.priorReturn.sourceDocument} label={`${r.priorReturn.sourceDocument} (2024 Form 1040 as filed)`} />. Each line links to the value
          the pipeline read from it.
        </p>
        <div className="px-4 py-2 text-xs text-stone-600">
          Dependents:{" "}
          {r.priorReturn.dependents.map((d, i) => (
            <span key={i}>
              {i > 0 ? "; " : ""}
              {d.name} <span className="num">{d.ssn}</span>
            </span>
          ))}
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-4 py-1.5 font-normal">Line</th>
              <th className="px-2 py-1.5 font-normal">Label</th>
              <th className="px-2 py-1.5 text-right font-normal">2024 value</th>
              <th className="px-2 py-1.5 font-normal">Read from</th>
            </tr>
          </thead>
          <tbody>
            {r.priorReturn.lines.map((l) => (
              <tr key={l.key} id={l.ref} className={`border-t border-stone-100 ${mark(l.ref)}`}>
                <td className="num px-4 py-1 text-xs">{l.key}</td>
                <td className="px-2 py-1">
                  {l.label}
                  {l.note ? <div className="text-xs text-stone-500">{l.note}</div> : null}
                </td>
                <td className="num px-2 py-1 text-right">{typeof l.value === "number" ? money(l.value) : l.display}</td>
                <td className="px-2 py-1 text-xs">
                  {l.sourceRef ? (
                    l.sourceFound ? (
                      <RefLink refId={l.sourceRef} label={`${l.sourceRef}: ${l.sourceLabel}`} />
                    ) : (
                      <span className="text-rose-700">{l.sourceRef} does not resolve</span>
                    )
                  ) : (
                    <span className="text-stone-400">no source recorded</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid gap-4 border-t border-stone-200 px-4 py-3 text-sm sm:grid-cols-2">
          <div id={r.priorReturn.k1_1120S.ref} className={`rounded p-2 ${mark(r.priorReturn.k1_1120S.ref)}`}>
            <div className="text-xs text-stone-500">2024 K-1 (Form 1120-S) as reported on the prior return</div>
            <KeyValues fields={r.priorReturn.k1_1120S.fields} />
          </div>
          <div id={r.priorReturn.k1_1065.ref} className={`rounded p-2 ${mark(r.priorReturn.k1_1065.ref)}`}>
            <div className="text-xs text-stone-500">2024 K-1 (Form 1065) as reported on the prior return</div>
            <KeyValues fields={r.priorReturn.k1_1065.fields} />
          </div>
        </div>
        {r.priorReturn.notes.length ? (
          <div className="border-t border-stone-200 px-4 py-3 text-xs text-stone-600">
            <div className="text-stone-500">Prior return notes</div>
            {r.priorReturn.notes.map((n) => (
              <div key={n.key}>
                <span className="num">{n.key}</span>: {n.note}
              </div>
            ))}
          </div>
        ) : null}
      </Section>

      <Section id="prior-workpaper" title="Prior preparer workpaper memo" subtitle={`from document ${r.priorWorkpaper.sourceDocument}`}>
        <div id={r.priorWorkpaper.ref} className={`space-y-3 px-4 py-3 text-sm ${mark(r.priorWorkpaper.ref)}`}>
          <p>{r.priorWorkpaper.summaryMemo}</p>
          <div>
            <div className="text-xs text-stone-500">Notes</div>
            <ul className="list-disc space-y-0.5 pl-5">
              {r.priorWorkpaper.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-xs text-stone-500">Open items left by the prior preparer</div>
            <ul className="list-disc space-y-0.5 pl-5">
              {r.priorWorkpaper.openItems.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-stone-500">
            Depreciation schedule: {r.priorWorkpaper.depreciationSchedule}. Source <RefLink refId={r.priorWorkpaper.sourceDocument} />.
          </p>
        </div>
      </Section>

      <Section id="assets" title="Asset records (placed in service before 2025)" subtitle={`${r.assets.length} assets`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="px-4 py-1.5 font-normal">Asset</th>
              <th className="px-2 py-1.5 font-normal">Activity</th>
              <th className="px-2 py-1.5 text-right font-normal">Cost</th>
              <th className="px-2 py-1.5 text-right font-normal">Land</th>
              <th className="px-2 py-1.5 font-normal">In service</th>
              <th className="px-2 py-1.5 font-normal">Method</th>
              <th className="px-2 py-1.5 font-normal">Federal by year</th>
              <th className="px-2 py-1.5 font-normal">California by year</th>
            </tr>
          </thead>
          <tbody>
            {r.assets.map((a) => (
              <tr key={a.assetId} id={a.pointer} className={`border-t border-stone-100 align-top ${mark(a.pointer) || mark(a.ref)}`}>
                <td className="px-4 py-1.5">
                  <span id={a.ref} className="num text-xs">
                    {a.assetId}
                  </span>
                  <div>{a.description}</div>
                  {a.disposed ? <div className="text-xs text-amber-800">disposed {a.disposed}</div> : null}
                  <div className="text-xs text-stone-400">sources: {a.sources.join(", ") || "none recorded"}</div>
                </td>
                <td className="px-2 py-1.5 text-xs">{a.activity}</td>
                <td className="num px-2 py-1.5 text-right">{a.cost === null ? "unknown" : money(a.cost)}</td>
                <td className="num px-2 py-1.5 text-right">{a.landValue === null ? "none" : money(a.landValue)}</td>
                <td className="num px-2 py-1.5 text-xs">
                  {a.placedInService}
                  <div className="text-stone-400">{a.lifeYears === null ? "" : `${a.lifeYears} yr`}</div>
                </td>
                <td className="px-2 py-1.5 text-xs">{a.method}</td>
                <td className="num px-2 py-1.5 text-xs">
                  {a.federal.map((y) => (
                    <div key={y.year}>
                      {y.year}: {money(y.amount, { cents: true })}
                    </div>
                  ))}
                </td>
                <td className="num px-2 py-1.5 text-xs">
                  {a.california.map((y) => (
                    <div key={y.year}>
                      {y.year}: {money(y.amount, { cents: true })}
                    </div>
                  ))}
                  {a.amtDifference !== "none recorded" ? <div className="text-stone-500">AMT difference: {a.amtDifference}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="basis" title="Basis records" subtitle="gaps are real gaps">
        <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
          {r.basis.map((g) => (
            <div key={g.key} id={g.ref} className={`rounded border border-stone-100 p-2 ${mark(g.ref)}`}>
              <div className="text-sm font-medium">{g.label}</div>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {g.rows.map((row) => (
                    <tr key={row.ref} id={row.ref} className={`border-t border-stone-100 align-top ${mark(row.ref)}`}>
                      <td className="num py-1 pr-2 text-stone-400">{row.ref.split("/").pop()}</td>
                      <td className="py-1">
                        {row.fields.map((f) => (
                          <div key={f.key} className="flex gap-2">
                            <span className="w-40 shrink-0 text-stone-500">{f.label}</span>
                            <span className={`num ${f.unknown ? "rounded bg-rose-100 px-1 text-rose-800" : ""}`}>{f.display}</span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Section>

      <Section id="carryovers" title="Carryovers into 2025" subtitle={r.carryovers.sources ?? ""}>
        <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
          <div>
            <div className="text-xs text-stone-500">Federal</div>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {r.carryovers.federal.map((c) => (
                  <tr key={c.ref} id={c.ref} className={`border-t border-stone-100 ${mark(c.ref)}`}>
                    <td className="py-1">{c.label}</td>
                    <td className="num py-1 text-right">{c.display === "unknown" ? <span className="rounded bg-rose-100 px-1 text-rose-800">unknown</span> : money(Number(c.display))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-xs text-stone-500">California</div>
            <table className="mt-1 w-full text-sm">
              <tbody>
                {r.carryovers.california.map((c) => (
                  <tr key={c.ref} id={c.ref} className={`border-t border-stone-100 ${mark(c.ref)}`}>
                    <td className="py-1">{c.label}</td>
                    <td className="num py-1 text-right">{c.display === "unknown" ? <span className="rounded bg-rose-100 px-1 text-rose-800">unknown</span> : money(Number(c.display))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.carryovers.californiaNote ? <p className="mt-2 text-xs text-stone-500">{r.carryovers.californiaNote}</p> : null}
          </div>
        </div>
      </Section>

      <Section id="agency" title="Tax agency records" subtitle={`as of the replay clock ${dateOnly(r.asOf)}`}>
        <div className="space-y-4 px-4 py-3 text-sm">
          <div id="agency:/irs_account_transcript_2025">
            <div className="text-xs text-stone-500">IRS account transcript, tax period December 2025</div>
            <div className="mt-1 grid gap-3 md:grid-cols-2">
              {r.agency.irs.map((s) => (
                <div key={s.ref} id={s.ref} className={`rounded border border-stone-100 p-2 ${mark(s.ref)}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      Snapshot as of <span className="num">{s.asOf}</span>
                    </span>
                    {s.available ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">available</span> : <FuturePreview at={s.asOf} />}
                  </div>
                  {s.transactions ? (
                    <table className="mt-1 w-full text-xs">
                      <tbody>
                        {s.transactions.map((tx, i) => (
                          <tr key={i} className="border-t border-stone-100">
                            <td className="num py-0.5">{tx.date}</td>
                            <td className="num py-0.5">{tx.code}</td>
                            <td className="py-0.5">{tx.description}</td>
                            <td className="num py-0.5 text-right">{money(tx.amount, { cents: true })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="mt-1 text-xs text-stone-500">Payload withheld: this snapshot does not exist yet at the replay clock.</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div id={r.agency.ftb.ref} className={`rounded border border-stone-100 p-2 ${mark(r.agency.ftb.ref)}`}>
            <div className="flex items-center justify-between text-xs">
              <span>
                FTB account as of <span className="num">{r.agency.ftb.asOf}</span>
              </span>
              {r.agency.ftb.available ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">available</span> : <FuturePreview at={r.agency.ftb.asOf} />}
            </div>
            {r.agency.ftb.payments2025 ? (
              <div className="mt-1 grid gap-3 text-xs md:grid-cols-2">
                <div>
                  <div className="text-stone-500">Tax year 2025 payments</div>
                  {r.agency.ftb.payments2025.map((p, i) => (
                    <div key={i} className="num flex justify-between">
                      <span>{p.date}</span>
                      <span>{money(p.amount, { cents: true })}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="text-stone-500">Tax year 2024 payments after filing</div>
                  {(r.agency.ftb.payments2024AfterFiling ?? []).map((p, i) => (
                    <div key={i}>
                      <div className="num flex justify-between">
                        <span>{p.date}</span>
                        <span>{money(p.amount, { cents: true })}</span>
                      </div>
                      {p.note ? <div className="text-stone-500">{p.note}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div id="agency:/notices">
            <div className="text-xs text-stone-500">Notices</div>
            <ul className="mt-1 space-y-2">
              {r.agency.notices.map((n) => (
                <li key={n.ref} id={n.ref} className={`rounded border border-stone-100 p-2 ${mark(n.ref)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span>
                      <span className="font-medium">{n.agency}</span> {n.type}, tax year <span className="num">{n.taxYear}</span>, dated <span className="num">{n.dated}</span>
                      {n.document ? (
                        <span>
                          , document <RefLink refId={n.document} />
                        </span>
                      ) : null}
                    </span>
                    {n.available ? <span className="num text-stone-400">{n.id}</span> : <FuturePreview at={n.dated} />}
                  </div>
                  {n.available ? (
                    <div className="mt-1 text-sm">
                      {n.summary ? <p>{n.summary}</p> : null}
                      {n.items.length ? (
                        <ul className="list-disc pl-5">
                          {n.items.map((it, i) => (
                            <li key={i}>{it}</li>
                          ))}
                        </ul>
                      ) : null}
                      {n.status ? <p className="text-xs text-stone-600">Status: {n.status}</p> : null}
                      {n.responseDue ? (
                        <p className="text-xs text-stone-600">
                          Response due <span className="num">{n.responseDue}</span>
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div id="agency:/efile">
            <div className="text-xs text-stone-500">E-file submissions</div>
            <table className="mt-1 w-full text-xs">
              <thead className="text-left text-stone-500">
                <tr>
                  <th className="py-1 font-normal">Date</th>
                  <th className="py-1 font-normal">Jurisdiction</th>
                  <th className="py-1 font-normal">Submission</th>
                  <th className="py-1 font-normal">Status</th>
                  <th className="py-1 font-normal">Errors</th>
                </tr>
              </thead>
              <tbody>
                {r.agency.efile.map((e) => (
                  <tr key={e.ref} id={e.ref} className={`border-t border-stone-100 align-top ${mark(e.ref)}`}>
                    <td className="num py-1">{dateTime(e.date)}</td>
                    {e.available ? (
                      <>
                        <td className="py-1">{e.jurisdiction}</td>
                        <td className="num py-1">{e.submissionId}</td>
                        <td className="py-1">{e.status?.replace(/_/g, " ")}</td>
                        <td className="py-1">
                          {e.errors.map((er, i) => (
                            <div key={i}>
                              <span className="num">{er.code}</span> {er.message}
                            </div>
                          ))}
                        </td>
                      </>
                    ) : (
                      <td colSpan={4} className="py-1">
                        <FuturePreview at={e.date} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section id="household" title="Household" subtitle={`${r.household.filingStatus.replace(/_/g, " ")}, tax year ${r.household.taxYear}; entered by ${r.household.enteredBy}`}>
        <div className="space-y-4 px-4 py-3 text-sm">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1 font-normal">Person</th>
                <th className="py-1 font-normal">Role</th>
                <th className="py-1 font-normal">SSN</th>
                <th className="py-1 font-normal">Born</th>
                <th className="py-1 font-normal">Details</th>
              </tr>
            </thead>
            <tbody>
              {r.household.people.map((p) => (
                <tr key={p.id} id={`household-${p.id}`} className={`border-t border-stone-100 align-top ${mark(p.ref)}`}>
                  <td className="py-1">
                    {p.name}
                    <div className="num text-xs text-stone-400">{p.ref}</div>
                  </td>
                  <td className="py-1">
                    {p.role}
                    {p.relationship ? ` (${p.relationship})` : ""}
                  </td>
                  <td className="num py-1">{p.ssn}</td>
                  <td className="num py-1">{p.dob}</td>
                  <td className="py-1 text-xs text-stone-600">
                    {p.occupation ? <div>{p.occupation}</div> : null}
                    {p.monthsLivedWithYou !== null ? <div>lived with you {p.monthsLivedWithYou} months</div> : null}
                    {p.fullTimeStudent ? <div>full-time student</div> : null}
                    {p.ownIncome ? <div>{p.ownIncome}</div> : null}
                    {p.note ? <div>{p.note}</div> : null}
                    {p.ipPin ? <div>IP PIN on file: {p.ipPin}</div> : null}
                    {p.phone ? <div className="num">{p.phone}</div> : null}
                    {p.email ? <div>{p.email}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs text-stone-500">Addresses</div>
              {r.household.addresses.map((a, i) => (
                <div key={i} className="text-xs">
                  <span className="num">
                    {a.from} to {a.to ?? "present"}
                  </span>
                  : {a.address} ({a.type})
                </div>
              ))}
            </div>
            <div>
              <div className="text-xs text-stone-500">Residency</div>
              {r.household.residency.map((s, i) => (
                <div key={i} className="text-xs">
                  <span className="num">
                    {s.from} to {s.to}
                  </span>
                  : {s.state} {s.status}
                </div>
              ))}
            </div>
          </div>
          <div className="text-xs text-stone-600">
            Refund or payment account: {r.household.bank.bank}, {r.household.bank.type}, routing <span className="num">{r.household.bank.routing}</span>, account{" "}
            <span className="num">{r.household.bank.account}</span>. Prior-year AGI for e-signature <span className="num">{money(r.household.priorYearAgiForEsignature)}</span>.
          </div>
          <div>
            <div className="text-xs text-stone-500">Related returns</div>
            <table className="mt-1 w-full text-xs">
              <tbody>
                {r.household.relatedReturns.map((rr, i) => (
                  <tr key={i} className="border-t border-stone-100 align-top">
                    <td className="py-1 pr-2 font-medium">{rr.who}</td>
                    <td className="py-1 pr-2">{rr.return}</td>
                    <td className="py-1 pr-2 text-stone-600">{rr.preparedBy}</td>
                    <td className="py-1 text-stone-600">in this packet: {rr.inThisPacket}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      <Section id="engine" title="Engine parameters and rules" subtitle="as supplied; treat as given">
        <div className="grid gap-4 px-4 py-3 md:grid-cols-2">
          <div>
            <div className="text-xs text-stone-500">Parameters</div>
            <table className="mt-1 w-full text-xs">
              <tbody>
                {r.engine.parameters.map((p) => (
                  <tr key={p.name} id={`engine-${p.ref}`} className={`border-t border-stone-100 align-top ${mark(p.ref)}`}>
                    <td className="num py-1 pr-2">{p.name}</td>
                    <td className="num py-1 break-all text-stone-700">{p.display}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="text-xs text-stone-500">Rules</div>
            <table className="mt-1 w-full text-xs">
              <tbody>
                {r.engine.rules.map((rule) => (
                  <tr key={rule.code} id={`rule-${rule.code}`} className="border-t border-stone-100 align-top">
                    <td className="num py-1 pr-2 whitespace-nowrap">{rule.code}</td>
                    <td className="py-1 text-stone-700">{rule.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}

function Section({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section id={id} className="rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-4 py-2.5">
        <h2 className="font-medium">{title}</h2>
        <span className="text-xs text-stone-500">{subtitle}</span>
      </div>
      {children}
    </section>
  );
}

function KeyValues({ fields }: { fields: { key: string; display: string }[] }) {
  return (
    <div className="mt-1 text-xs">
      {fields.map((f) => (
        <div key={f.key} className="flex gap-2">
          <span className="w-32 shrink-0 text-stone-500">{f.key.replace(/_/g, " ")}</span>
          <span className="num">{f.display}</span>
        </div>
      ))}
    </div>
  );
}

function FuturePreview({ at }: { at: string }) {
  return (
    <span className="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-700">
      future, replay preview: available <span className="num">{dateOnly(at.length === 10 ? `${at}T00:00:00Z` : at)}</span>
    </span>
  );
}
