import Link from "next/link";
import { CommandButton } from "@/components/command-client";
import { RefLink } from "@/components/ref-link";
import { dateTime } from "@/lib/format";
import { requireSessionContext } from "@/server/request";
import { timelineView } from "@/server/queries/changes";

export const dynamic = "force-dynamic";

export default async function TimelinePage() {
  const ctx = await requireSessionContext();
  const tv = await timelineView(ctx);
  const revision = ctx.workspace.revision;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Replay timeline</h1>
        <p className="mt-1 text-sm text-stone-600">
          The packet&apos;s engagement events in order. Events up to the replay clock are history with their detail and references; later events are a
          preview and show only their name and date until the clock reaches them.
        </p>
      </section>

      <section className="rounded-lg border border-stone-800 bg-stone-900 px-5 py-4 text-stone-50">
        <div className="text-xs uppercase tracking-wide text-stone-400">Replay clock</div>
        <div className="num mt-1 text-3xl font-semibold">{dateTime(tv.asOf)}</div>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone-300">
          <span>
            engine baseline <span className="num text-stone-50">{tv.activeVersion}</span> (separate from the clock; change it under{" "}
            <Link href="/changes/versions" className="text-blue-300 hover:underline">
              Versions
            </Link>
            )
          </span>
          <span>
            <span className="num text-stone-50">{tv.pastCount}</span> event(s) have happened, <span className="num text-stone-50">{tv.futureCount}</span> ahead
          </span>
          {tv.clockAtEventId ? (
            <span>
              clock sits after <a href={`#${tv.clockAtEventId}`} className="num text-blue-300 hover:underline">{tv.clockAtEventId}</a>
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Advancing the clock makes later evidence available and later staff active; it never changes the engine version and never satisfies a review step
          by itself.
        </p>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white">
        <ol>
          {tv.events.map((e) => (
            <li key={e.id} id={e.id} className={`border-t border-stone-100 px-5 py-3 first:border-t-0 ${e.isPast ? "" : "bg-stone-50"}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="num text-xs text-stone-500">{dateTime(e.at)}</span>
                <span className={`font-medium ${e.isPast ? "" : "text-stone-600"}`}>{e.eventLabel}</span>
                <span className="num text-xs text-stone-400">{e.id}</span>
                {e.actorName ? <span className="text-xs text-stone-500">{e.actorName}</span> : null}
                {e.isPast ? (
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">past</span>
                ) : (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">future, replay preview</span>
                )}
                {e.isExtension ? (
                  <span className="text-xs text-stone-500">
                    special id; the estimate behind it is under{" "}
                    <Link href="/changes/whatif#extension" className="text-blue-700 hover:underline">
                      What-ifs
                    </Link>
                  </span>
                ) : null}
                {e.id === tv.clockAtEventId ? <span className="rounded bg-stone-800 px-1.5 py-0.5 text-xs text-white">clock is here</span> : null}
              </div>
              {e.isPast ? (
                <>
                  {e.detail ? <p className="mt-1 text-sm text-stone-700">{e.detail}</p> : null}
                  {e.refs.length ? (
                    <ul className="mt-1 space-y-0.5">
                      {e.refs.map((r) => (
                        <li key={r.ref} className="text-xs">
                          <RefLink refId={r.ref} label={r.ref} />
                          <span className={`ml-1 ${r.found ? "text-stone-500" : "text-red-600"}`}>{r.label}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : (
                <div className="mt-2">
                  <CommandButton
                    revision={revision}
                    type="advance_time"
                    payload={{ to: e.at }}
                    confirm={`Move the replay clock to ${dateTime(e.at)} (${e.eventLabel})? Evidence received up to then becomes available. The engine baseline stays ${tv.activeVersion}.`}
                  >
                    Advance clock to this event
                  </CommandButton>
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
