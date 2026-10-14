import { requireSessionContext } from "@/server/request";
import { AREAS } from "@/domain/areas";

export const dynamic = "force-dynamic";

/** Firm standards, staff and budgets as supplied. Editing standards arrives in a later phase. */
export default async function FirmPage() {
  const ctx = await requireSessionContext();
  const firm = ctx.packet.packet.firm;
  const std = firm.starter_standards;
  return (
    <div className="max-w-4xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">{firm.name}</h1>
      <section>
        <h2 className="font-medium">Staff</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs text-stone-500">
            <tr>
              <th className="py-1 font-normal">Person</th>
              <th className="py-1 font-normal">Role</th>
              <th className="py-1 font-normal">Credential</th>
              <th className="py-1 font-normal">Sensitive clearance</th>
              <th className="py-1 font-normal">Active from</th>
            </tr>
          </thead>
          <tbody>
            {firm.staff.map((s) => (
              <tr key={s.id} className="border-t border-stone-100">
                <td className="py-1">{s.name}</td>
                <td className="py-1">{s.role.replace(/_/g, " ")}</td>
                <td className="py-1">{s.credential ?? ""}</td>
                <td className="py-1">{s.sensitive_data_clearance ? "yes" : "no"}</td>
                <td className="num py-1">{s.active_from}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="font-medium">Standards in force (starter, version 1)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {std.rules.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-stone-500">
          Variance review flags changes over {std.variance_review.flag_if_change_over_percent}% and over {std.variance_review.and_over_amount} against the
          prior year. Verification methods: {std.verification_types.map((v) => v.replace(/_/g, " ")).join(", ")}.
        </p>
      </section>
      <section>
        <h2 className="font-medium">Budget hours by area</h2>
        <table className="mt-2 text-sm">
          <tbody>
            {AREAS.filter((a) => a.budgetKey).map((a) => (
              <tr key={a.id} className="border-t border-stone-100">
                <td className="py-1 pr-6">{a.label}</td>
                <td className="num py-1">{firm.budget_hours[a.budgetKey!] ?? 0} h</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-stone-500">Time entries against these budgets are built in a later phase.</p>
      </section>
    </div>
  );
}
