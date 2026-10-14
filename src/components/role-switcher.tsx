"use client";

import { usePathname } from "next/navigation";

export interface PersonaOption {
  id: string;
  name: string;
  role: string;
  available: boolean;
  clearance: boolean;
}

/**
 * Demo persona switcher. Submitting changes the session's actor on the server;
 * nothing here grants a permission, every command re-checks policy.
 */
export function RoleSwitcher({ personas, currentId }: { personas: PersonaOption[]; currentId: string }) {
  const pathname = usePathname();
  return (
    <form action="/api/session/switch" method="post" className="flex items-center gap-2">
      <input type="hidden" name="next" value={pathname} />
      <label className="text-xs text-stone-500" htmlFor="actorId">
        Acting as
      </label>
      <select
        id="actorId"
        name="actorId"
        defaultValue={currentId}
        className="rounded border border-stone-300 bg-white px-2 py-1 text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {personas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.role.replace(/_/g, " ")}){p.available ? "" : ", not yet active"}{p.clearance ? "" : ", no sensitive clearance"}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="rounded bg-stone-800 px-2 py-1 text-xs text-white">
          Switch
        </button>
      </noscript>
    </form>
  );
}
