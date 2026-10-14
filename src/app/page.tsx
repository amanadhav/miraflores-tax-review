import { redirect } from "next/navigation";
import { loadPacket } from "@/packet/load";
import { actorsFromPacket } from "@/domain/policy";
import { getSessionContext } from "@/server/request";

export default async function Landing({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ctx = await getSessionContext();
  if (ctx) redirect(ctx.actor.role === "client" ? "/client" : "/overview");
  const { packet, sha256 } = loadPacket();
  const { error } = await searchParams;
  const personas = actorsFromPacket(packet);
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Trace</h1>
      <p className="mt-2 text-stone-600">
        An evidence-centered workpaper for the {packet.packet.name}. Every number traces to its printed source, every change keeps the
        original, and every approval reopens when what it covered changes.
      </p>
      <p className="mt-2 text-xs text-stone-500">
        Packet loaded as delivered: {packet.documents.length} documents, {packet.extracted_values.length} extracted values,{" "}
        {packet.return_versions.length} computed versions. SHA-256 {sha256.slice(0, 16)}.
      </p>
      {error ? <p className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">Could not join: {error.replace(/-/g, " ")}.</p> : null}

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <form action="/api/session/start" method="post" className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="font-medium">Start a new workspace</h2>
          <p className="mt-1 text-sm text-stone-600">
            Your own copy of the engagement at return version v3 (June 23, 2026), acting as the assigned preparer. Nobody else&apos;s work is
            touched.
          </p>
          <label className="mt-4 block text-xs text-stone-500" htmlFor="name">
            Name (optional)
          </label>
          <input id="name" name="name" className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm" placeholder="Evaluator demo" />
          <button type="submit" className="mt-4 rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700">
            Start workspace
          </button>
        </form>

        <form action="/api/session/join" method="post" className="rounded-lg border border-stone-200 bg-white p-5 shadow-sm">
          <h2 className="font-medium">Join an existing workspace</h2>
          <p className="mt-1 text-sm text-stone-600">
            Open the same workpaper in a second browser as a different person to see two people working at once.
          </p>
          <label className="mt-4 block text-xs text-stone-500" htmlFor="workspaceId">
            Workspace id (shown in the header)
          </label>
          <input id="workspaceId" name="workspaceId" required className="mt-1 w-full rounded border border-stone-300 px-2 py-1 text-sm" placeholder="ws_xxxxxxxx" />
          <label className="mt-3 block text-xs text-stone-500" htmlFor="actorId">
            Join as
          </label>
          <select id="actorId" name="actorId" defaultValue="st-02" className="mt-1 w-full rounded border border-stone-300 bg-white px-2 py-1 text-sm">
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.role.replace(/_/g, " ")})
              </option>
            ))}
          </select>
          <button type="submit" className="mt-4 rounded border border-stone-900 px-4 py-2 text-sm font-medium hover:bg-stone-100">
            Join workspace
          </button>
        </form>
      </section>
    </main>
  );
}
