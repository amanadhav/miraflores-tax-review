import type { DbHandle } from "@/db/client";
import type { LoadedPacket } from "@/packet/load";
import { loadSessionContext, refreshContext, type SessionContext } from "@/server/context";
import { createSession, createWorkspace } from "@/server/workspace";
import { dispatch, type CommandEnvelope, type CommandResult } from "@/server/handlers";

let keyCounter = 0;

export function key(prefix = "test"): string {
  keyCounter += 1;
  return `${prefix}-${Date.now()}-${keyCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface Persona {
  ctx: SessionContext;
  /** Dispatch using the latest revision the persona has seen (re-read first). */
  run: (type: string, payload: unknown, opts?: { expectedRevision?: number; idempotencyKey?: string }) => Promise<CommandResult>;
  refresh: () => Promise<SessionContext>;
}

export async function newWorkspace(handle: DbHandle, loaded: LoadedPacket) {
  return createWorkspace(handle.db, loaded, "test workspace");
}

export async function persona(handle: DbHandle, loaded: LoadedPacket, workspaceId: string, actorId: string): Promise<Persona> {
  const session = await createSession(handle.db, loaded, workspaceId, actorId);
  let ctx = (await loadSessionContext(handle.db, loaded, session.id))!;
  const refresh = async () => {
    ctx = await refreshContext(ctx);
    return ctx;
  };
  const run: Persona["run"] = async (type, payload, opts) => {
    await refresh();
    const envelope: CommandEnvelope = {
      type,
      payload,
      expectedRevision: opts?.expectedRevision ?? ctx.workspace.revision,
      idempotencyKey: opts?.idempotencyKey ?? key(type),
    };
    const result = await dispatch(ctx, envelope);
    await refresh();
    return result;
  };
  return {
    get ctx() {
      return ctx;
    },
    run,
    refresh,
  };
}
