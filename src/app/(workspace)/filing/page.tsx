import { requireSessionContext } from "@/server/request";
import { loadOverview } from "@/server/queries/overview";

export const dynamic = "force-dynamic";

/**
 * Filing. The lifecycle (client approval, submission attempts, freeze, amend)
 * is built in a later phase. Until then this screen only reports what would
 * block filing today; it does not pretend a filing can be made.
 */
export default async function FilingPage() {
  const ctx = await requireSessionContext();
  const o = await loadOverview(ctx);
  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Filing</h1>
      <p className="text-sm text-stone-600">
        Workflow state: <span className="font-medium">{ctx.workspace.workflowState.replace(/_/g, " ")}</span>. Filing transitions are not yet
        implemented in this build; the prerequisites below are enforced server-side and will gate them.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        <li>{o.blockers.length} open finding(s) block filing.</li>
        <li>{o.proposals} proposed change(s) still await a decision.</li>
        <li>{o.state.effective.staleKeys.length} line(s) are stale and need review.</li>
        <li>
          Area sign-offs: {o.areas.filter((a) => a.signoffs.reviewer === "active").length} of {o.areas.length} areas have an active reviewer
          sign-off; {o.areas.filter((a) => a.signoffs.partner === "active").length} have partner sign-off.
        </li>
      </ul>
    </div>
  );
}
