/**
 * The single path for every mutation. A command carries the caller's expected
 * revision and an idempotency key; the server derives actor and workspace from
 * the session, locks the workspace row, checks availability, permissions and
 * the filing lock, applies the mutation, re-evaluates sign-offs, writes the
 * audit record and bumps the revision, all in one transaction.
 */
import { and, eq, gt, asc } from "drizzle-orm";
import { z, ZodError } from "zod";
import type { Db } from "@/db/client";
import * as t from "@/db/schema";
import { PolicyError, requireAvailable } from "@/domain/policy";
import type { SessionContext } from "./context";
import { invalidateStaleSignoffs } from "./invalidation";

export interface CommandEnvelope {
  type: string;
  payload: unknown;
  expectedRevision: number;
  idempotencyKey: string;
}

export type AuditRow = typeof t.auditEvents.$inferSelect;

export interface AuditSeed {
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  area?: string | null;
}

export interface HandlerContext {
  tx: Db;
  ctx: SessionContext;
  /** Revision this command will produce when it commits. */
  revision: number;
  /** Wall-clock server time (audit). */
  now: string;
  /** Simulated business time of the engagement (replay clock). */
  businessTime: string;
}

export interface HandlerOutcome {
  result: unknown;
  events: AuditSeed[];
}

export interface CommandHandler<P> {
  type: string;
  schema: z.ZodType<P>;
  /** Commands that remain allowed once filing is locked (read-only style records). */
  allowedWhenLocked?: boolean;
  handle: (hc: HandlerContext, payload: P) => Promise<HandlerOutcome>;
}

const registry = new Map<string, CommandHandler<unknown>>();

export function registerHandler<P>(handler: CommandHandler<P>): void {
  registry.set(handler.type, handler as CommandHandler<unknown>);
}

export function registeredCommandTypes(): string[] {
  return [...registry.keys()];
}

export type CommandResult =
  | { ok: true; revision: number; result: unknown; replayed: boolean }
  | {
      ok: false;
      error: {
        code: "conflict" | "forbidden" | "unavailable" | "self_review" | "partner_required" | "filing_locked" | "validation" | "unknown_command" | "not_found" | "invalid_state" | "internal";
        message: string;
        currentRevision?: number;
        changesSince?: AuditRow[];
        issues?: { path: string; message: string }[];
      };
    };

export class CommandError extends Error {
  readonly code: "not_found" | "invalid_state" | "validation";
  constructor(code: CommandError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export const envelopeSchema = z.object({
  type: z.string().min(1),
  payload: z.unknown(),
  expectedRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(200),
});

export async function dispatch(ctx: SessionContext, envelope: CommandEnvelope): Promise<CommandResult> {
  const handler = registry.get(envelope.type);
  if (!handler) return { ok: false, error: { code: "unknown_command", message: `Unknown command ${envelope.type}.` } };
  const db = ctx.db;
  try {
    return await db.transaction(async (tx) => {
      // Serialize all commands for this engagement: a filing and a correction
      // cannot interleave, whatever the default isolation level does.
      const [workspace] = await tx.select().from(t.workspaces).where(eq(t.workspaces.id, ctx.workspace.id)).for("update");
      if (!workspace) return fail("not_found", "Workspace no longer exists.");

      const [prior] = await tx
        .select()
        .from(t.commands)
        .where(and(eq(t.commands.workspaceId, workspace.id), eq(t.commands.id, envelope.idempotencyKey)));
      if (prior) {
        // Same command delivered twice: return the first outcome, apply nothing.
        return { ok: true, revision: prior.revisionAfter, result: prior.result, replayed: true } as const;
      }

      if (workspace.revision !== envelope.expectedRevision) {
        const changesSince = await tx
          .select()
          .from(t.auditEvents)
          .where(and(eq(t.auditEvents.workspaceId, workspace.id), gt(t.auditEvents.revision, envelope.expectedRevision)))
          .orderBy(asc(t.auditEvents.revision), asc(t.auditEvents.id))
          .limit(100);
        return {
          ok: false,
          error: {
            code: "conflict",
            message: `The workpaper changed (now revision ${workspace.revision}, you had ${envelope.expectedRevision}). Review what changed and retry.`,
            currentRevision: workspace.revision,
            changesSince,
          },
        } as const;
      }

      if (workspace.filingLocked && !handler.allowedWhenLocked) {
        throw new PolicyError("filing_locked", "The return is frozen for filing. Changes must go to an amendment.");
      }
      requireAvailable(ctx.actor, workspace.asOf);

      const payload = handler.schema.parse(envelope.payload);
      const revision = workspace.revision + 1;
      const now = new Date().toISOString();
      // Drivers return timestamps in their own text format; normalize once to ISO UTC.
      const businessTime = new Date(workspace.asOf).toISOString();
      const hc: HandlerContext = { tx, ctx: { ...ctx, workspace }, revision, now, businessTime };
      const outcome = await handler.handle(hc, payload);

      const invalidations = await invalidateStaleSignoffs(hc);
      const events = [...outcome.events, ...invalidations];
      if (events.length) {
        await tx.insert(t.auditEvents).values(
          events.map((e) => ({
            workspaceId: workspace.id,
            revision,
            commandId: envelope.idempotencyKey,
            actorId: ctx.actor.id,
            action: e.action,
            entityType: e.entityType,
            entityId: e.entityId,
            summary: e.summary,
            before: e.before ?? null,
            after: e.after ?? null,
            area: e.area ?? null,
            businessTime,
          })),
        );
      }
      await tx.update(t.workspaces).set({ revision }).where(eq(t.workspaces.id, workspace.id));
      await tx.insert(t.commands).values({
        workspaceId: workspace.id,
        id: envelope.idempotencyKey,
        actorId: ctx.actor.id,
        type: envelope.type,
        payload: envelope.payload ?? null,
        status: "applied",
        result: outcome.result ?? null,
        revisionBefore: workspace.revision,
        revisionAfter: revision,
      });
      return { ok: true, revision, result: outcome.result, replayed: false } as const;
    });
  } catch (error) {
    if (error instanceof PolicyError) return fail(error.code, error.message);
    if (error instanceof CommandError) return fail(error.code, error.message);
    if (error instanceof ZodError) {
      return {
        ok: false,
        error: {
          code: "validation",
          message: "The request was not valid.",
          issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      };
    }
    console.error("command failed", envelope.type, error);
    return fail("internal", error instanceof Error ? error.message : "Unexpected error.");
  }
}

function fail(code: Exclude<CommandResult, { ok: true }>["error"]["code"], message: string): CommandResult {
  return { ok: false, error: { code, message } };
}
