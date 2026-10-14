import { requireSessionContext } from "@/server/request";

export const dynamic = "force-dynamic";

/**
 * Client portal. Clients only ever see their own requests and approval
 * presentation; internal review notes are never sent to this screen.
 * Requests and approvals are built in a later phase; nothing is simulated here.
 */
export default async function ClientPage() {
  const ctx = await requireSessionContext();
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Hello, {ctx.actor.name}</h1>
      <p className="text-sm text-stone-600">
        This is the client view for the {ctx.packet.packet.packet.name}. There are no open requests for you yet, and no return has been
        presented for approval.
      </p>
      <p className="text-xs text-stone-500">Internal workpaper screens are not available to client users.</p>
    </div>
  );
}
