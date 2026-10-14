import Link from "next/link";
import { StandardsEditForm } from "@/components/standards-form";
import { dateTime } from "@/lib/format";
import { isRefusal } from "@/server/queries/people";
import { requireSessionContext } from "@/server/request";
import { standardsView, type ListDiff, type StandardsVersionView } from "./view";

export const dynamic = "force-dynamic";

function DiffList({ title, diff }: { title: string; diff: ListDiff }) {
  if (diff.added.length === 0 && diff.removed.length === 0) return null;
  return (
    <div>
      <div className="text-xs font-medium text-stone-500">{title}</div>
      <ul className="mt-0.5 space-y-0.5 text-xs">
        {diff.added.map((x) => (
          <li key={`a-${x}`} className="text-emerald-800">
            + {x}
          </li>
        ))}
        {diff.removed.map((x) => (
          <li key={`r-${x}`} className="text-red-800">
            - {x}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VersionDiff({ v }: { v: StandardsVersionView }) {
  if (!v.diff) return <p className="text-xs text-stone-500">The packet&apos;s starter standard; nothing to compare against.</p>;
  const d = v.diff;
  const empty = [d.rules, d.requiredSteps, d.verificationTypes, d.reviewLevels].every((x) => x.added.length === 0 && x.removed.length === 0) && !d.variance;
  if (empty) return <p className="text-xs text-stone-500">Republished with no change to the lists or thresholds (note only).</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DiffList title="Rules" diff={d.rules} />
      <DiffList title="Required steps" diff={d.requiredSteps} />
      <DiffList title="Verification types" diff={d.verificationTypes} />
      <DiffList title="Review levels" diff={d.reviewLevels} />
      {d.variance ? (
        <div className="text-xs">
          <div className="font-medium text-stone-500">Variance review</div>
          <div className="text-red-800">
            - {d.variance.before.percent}% and {d.variance.before.amount.toLocaleString("en-US")} against the {d.variance.before.compareTo.replace(/_/g, " ")}
          </div>
          <div className="text-emerald-800">
            + {d.variance.after.percent}% and {d.variance.after.amount.toLocaleString("en-US")} against the {d.variance.after.compareTo.replace(/_/g, " ")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The firm standard in force, its history with diffs, and the administrator's edit form. */
export default async function StandardsPage() {
  const ctx = await requireSessionContext();
  const v = await standardsView(ctx);
  if (isRefusal(v)) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Firm standards</h1>
        <p className="text-sm text-stone-600">{v.message}</p>
      </div>
    );
  }
  const c = v.current.body;

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs text-stone-500">
          <Link href="/firm" className="hover:underline">
            Firm
          </Link>{" "}
          / Standards
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Firm standards</h1>
        <p className="mt-1 text-sm text-stone-600">
          Version <span className="num">{v.current.version}</span> is in force (<span className="num">{v.current.id}</span>). Sign-offs and client approvals are fingerprinted over the version they were given under, so publishing a new version reopens
          every active one. {v.exposure.activeSignoffs} sign-off(s) and {v.exposure.activeApprovals} client approval(s) are active now.
        </p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-medium">
          In force: version <span className="num">{v.current.version}</span>
        </h2>
        <p className="mt-0.5 text-xs text-stone-500">{c.note}</p>
        <div className="mt-3 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-medium text-stone-500">Rules</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {c.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-medium text-stone-500">Required steps before filing</h3>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
              {c.requiredSteps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-stone-100 pt-3 text-sm">
          <dt className="text-stone-500">Verification types</dt>
          <dd>{c.verificationTypes.map((x) => x.replace(/_/g, " ")).join(", ")}</dd>
          <dt className="text-stone-500">Review levels</dt>
          <dd>{c.reviewLevels.join(", ")}</dd>
          <dt className="text-stone-500">Variance review</dt>
          <dd>
            Flag a line that moved more than {c.variance.percent}% and more than {c.variance.amount.toLocaleString("en-US")} against the {c.variance.compareTo.replace(/_/g, " ")}.
          </dd>
        </dl>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="font-medium">Publish a new version</h2>
        <p className="mt-0.5 text-xs text-stone-500">Only the firm administrator may change standards. The new version is in force from the revision it is published at; earlier versions stay in the history.</p>
        <div className="mt-3">
          <StandardsEditForm
            revision={v.revision}
            canEdit={v.actor.canEdit}
            actorRole={v.actor.role}
            current={{ rules: c.rules, requiredSteps: c.requiredSteps, verificationTypes: c.verificationTypes, reviewLevels: c.reviewLevels, variance: c.variance }}
            activeSignoffs={v.exposure.activeSignoffs}
            activeApprovals={v.exposure.activeApprovals}
          />
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-200 px-5 py-3">
          <h2 className="font-medium">History</h2>
          <p className="mt-0.5 text-xs text-stone-500">Newest first. Each version shows who published it, when, the note, and what changed against the version before.</p>
        </div>
        <ul className="divide-y divide-stone-100">
          {v.history.map((h) => (
            <li key={h.id} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
                <span className="font-medium">
                  Version <span className="num">{h.version}</span>
                </span>
                {h.version === v.current.version ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">in force</span> : null}
                <span className="num text-xs text-stone-400">{h.id}</span>
                {h.createdBy ? (
                  <span className="text-xs text-stone-500">
                    published by {h.createdBy.name} ({h.createdBy.role}) at revision <span className="num">{h.createdRevision}</span>, {dateTime(h.createdAt)}
                  </span>
                ) : (
                  <span className="text-xs text-stone-500">supplied with the packet</span>
                )}
              </div>
              <p className="mt-1 text-sm text-stone-700">{h.note}</p>
              <div className="mt-2">
                <VersionDiff v={h} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
