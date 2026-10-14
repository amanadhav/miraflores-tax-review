import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/* ------------------------------------------------------------------------ */
/* Immutable packet data: imported once per distinct packet (keyed by hash). */
/* ------------------------------------------------------------------------ */

export const packets = pgTable("packets", {
  id: text("id").primaryKey(), // SHA-256 of the original bytes
  name: text("name").notNull(),
  version: text("version").notNull(),
  generated: text("generated").notNull(),
  clientId: text("client_id").notNull(),
  byteLength: integer("byte_length").notNull(),
  raw: jsonb("raw").$type<unknown>().notNull(),
  importedAt: ts("imported_at").notNull().defaultNow(),
});

export const documents = pgTable(
  "documents",
  {
    packetId: text("packet_id").notNull(),
    id: text("id").notNull(),
    title: text("title").notNull(),
    documentType: text("document_type").notNull(),
    issuer: text("issuer").notNull(),
    belongsTo: text("belongs_to").notNull(),
    taxYear: integer("tax_year").notNull(),
    receivedAt: ts("received_at").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    fileName: text("file_name").notNull(),
    pageCount: integer("page_count").notNull(),
    markedCorrected: boolean("marked_corrected"),
    extractionStatus: text("extraction_status").notNull(),
    extractionValues: integer("extraction_values").notNull(),
    extractionReason: text("extraction_reason"),
  },
  (t) => [primaryKey({ columns: [t.packetId, t.id] }), index("documents_received_idx").on(t.packetId, t.receivedAt)],
);

export const documentPages = pgTable(
  "document_pages",
  {
    packetId: text("packet_id").notNull(),
    documentId: text("document_id").notNull(),
    page: integer("page").notNull(),
    printedContent: text("printed_content").notNull(),
  },
  (t) => [primaryKey({ columns: [t.packetId, t.documentId, t.page] })],
);

export const extractedValues = pgTable(
  "extracted_values",
  {
    packetId: text("packet_id").notNull(),
    id: text("id").notNull(),
    documentId: text("document_id").notNull(),
    page: integer("page").notNull(),
    field: text("field").notNull(),
    label: text("label").notNull(),
    value: jsonb("value").$type<unknown>(),
    valueType: text("value_type").notNull(),
    textAsRead: text("text_as_read").notNull(),
    position: jsonb("position").$type<{ x0: number; y0: number; x1: number; y1: number }>().notNull(),
    confidence: real("confidence").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.packetId, t.id] }),
    index("extracted_values_page_idx").on(t.packetId, t.documentId, t.page),
  ],
);

export const returnLines = pgTable(
  "return_lines",
  {
    packetId: text("packet_id").notNull(),
    version: text("version").notNull(),
    key: text("key").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    form: text("form").notNull(),
    line: text("line").notNull(),
    label: text("label").notNull(),
    value: jsonb("value").$type<number | string | boolean | null>(),
    rule: text("rule").notNull(),
    inputs: jsonb("inputs").$type<string[]>().notNull(),
    sources: jsonb("sources").$type<string[]>().notNull(),
    note: text("note"),
  },
  (t) => [
    primaryKey({ columns: [t.packetId, t.version, t.key] }),
    index("return_lines_form_idx").on(t.packetId, t.version, t.form),
  ],
);

/**
 * Directed reference graph. `from` is the thing used; `to` is the thing that
 * uses it. Packet-derived edges have a null workspace; workpaper-created edges
 * (adjustment evidence, manual anchors, verifications) carry their workspace.
 */
export const referenceEdges = pgTable(
  "reference_edges",
  {
    id: serial("id").primaryKey(),
    packetId: text("packet_id").notNull(),
    workspaceId: text("workspace_id"),
    version: text("version"),
    fromRef: text("from_ref").notNull(),
    toRef: text("to_ref").notNull(),
    relation: text("relation").notNull(), // supports | computes | supersedes | duplicates | contradicts | related | anchors
    origin: text("origin").notNull(), // engine | workpaper
  },
  (t) => [
    index("reference_edges_from_idx").on(t.packetId, t.fromRef),
    index("reference_edges_to_idx").on(t.packetId, t.toRef),
    index("reference_edges_workspace_idx").on(t.workspaceId),
  ],
);

/* ------------------------------------------------------------------------ */
/* Workspaces (engagements) and sessions.                                     */
/* ------------------------------------------------------------------------ */

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  packetId: text("packet_id").notNull(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  revision: integer("revision").notNull().default(0),
  asOf: ts("as_of").notNull(), // simulated business time (replay clock)
  activeVersion: text("active_version").notNull(),
  workflowState: text("workflow_state").notNull().default("preparing"),
  filingLocked: boolean("filing_locked").notNull().default(false),
  assignedPreparer: text("assigned_preparer").notNull(),
  assignedReviewer: text("assigned_reviewer").notNull(),
  assignedPartner: text("assigned_partner").notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
});

export const seenCursors = pgTable(
  "seen_cursors",
  {
    workspaceId: text("workspace_id").notNull(),
    actorId: text("actor_id").notNull(),
    revision: integer("revision").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.actorId] })],
);

/* ------------------------------------------------------------------------ */
/* Commands (idempotency) and the append-only audit log.                      */
/* ------------------------------------------------------------------------ */

export const commands = pgTable(
  "commands",
  {
    workspaceId: text("workspace_id").notNull(),
    id: text("id").notNull(), // idempotency key supplied by the client
    actorId: text("actor_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    status: text("status").notNull(), // applied | rejected
    result: jsonb("result").$type<unknown>(),
    revisionBefore: integer("revision_before").notNull(),
    revisionAfter: integer("revision_after").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.id] })],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    revision: integer("revision").notNull(),
    commandId: text("command_id"),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    before: jsonb("before").$type<unknown>(),
    after: jsonb("after").$type<unknown>(),
    area: text("area"),
    businessTime: ts("business_time").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_events_workspace_rev_idx").on(t.workspaceId, t.revision)],
);

/* ------------------------------------------------------------------------ */
/* Workpaper records.                                                         */
/* ------------------------------------------------------------------------ */

export const adjustments = pgTable(
  "adjustments",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    targetRef: text("target_ref").notNull(), // return line key
    baselineVersion: text("baseline_version").notNull(),
    area: text("area").notNull(),
    kind: text("kind").notNull(), // value | label | evidence
    priorValue: jsonb("prior_value").$type<unknown>(),
    proposedValue: jsonb("proposed_value").$type<unknown>(),
    priorLabel: text("prior_label"),
    proposedLabel: text("proposed_label"),
    reason: text("reason").notNull(),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull(),
    category: text("category"), // tax effect category or null for zero-effect changes
    measureDelta: numeric("measure_delta", { precision: 16, scale: 2 }),
    caSource: boolean("ca_source").notNull().default(false),
    effectFederal: numeric("effect_federal", { precision: 16, scale: 2 }),
    effectCalifornia: numeric("effect_california", { precision: 16, scale: 2 }),
    effectStatus: text("effect_status").notNull(), // estimated | exact_local | none | unknown
    effectBasis: text("effect_basis"),
    limitations: jsonb("limitations").$type<string[]>().notNull(),
    requiresPartner: boolean("requires_partner").notNull().default(false),
    status: text("status").notNull(), // proposed | accepted | rejected | superseded | reverted
    authorId: text("author_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdRevision: integer("created_revision").notNull(),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    decidedRevision: integer("decided_revision"),
    decisionNote: text("decision_note"),
    supersedesId: text("supersedes_id"),
    revertsId: text("reverts_id"),
  },
  (t) => [index("adjustments_workspace_target_idx").on(t.workspaceId, t.targetRef)],
);

export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    origin: text("origin").notNull(), // engine_diagnostic | reviewer | system
    code: text("code"),
    severity: text("severity").notNull(), // info | warning | blocker
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    refs: jsonb("refs").$type<string[]>().notNull(),
    area: text("area").notNull(),
    blocksFiling: boolean("blocks_filing").notNull().default(false),
    status: text("status").notNull(), // open | resolved | dismissed
    ownerId: text("owner_id"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdRevision: integer("created_revision").notNull(),
    engineVersion: text("engine_version"),
    fingerprint: text("fingerprint"),
    resolvedBy: text("resolved_by"),
    resolvedAt: ts("resolved_at"),
    resolvedRevision: integer("resolved_revision"),
    resolution: text("resolution"),
  },
  (t) => [index("findings_workspace_status_idx").on(t.workspaceId, t.status)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    subjectRef: text("subject_ref").notNull(),
    area: text("area").notNull(),
    method: text("method").notNull(),
    evidenceRefs: jsonb("evidence_refs").$type<string[]>().notNull(),
    conclusion: text("conclusion").notNull(), // agrees | disagrees | unresolved
    note: text("note"),
    actorId: text("actor_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdRevision: integer("created_revision").notNull(),
  },
  (t) => [index("verifications_workspace_subject_idx").on(t.workspaceId, t.subjectRef)],
);

/**
 * Exact text anchors inside simulated source pages. A later real-document
 * adapter can add coordinates without changing any link that points here.
 */
export const anchors = pgTable(
  "anchors",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    subjectRef: text("subject_ref").notNull(), // what the anchor supports (line key, ev id, adjustment id)
    documentId: text("document_id").notNull(),
    page: integer("page").notNull(),
    textSpan: text("text_span").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    origin: text("origin").notNull(), // field_match | manual
    note: text("note"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdRevision: integer("created_revision").notNull(),
  },
  (t) => [index("anchors_workspace_subject_idx").on(t.workspaceId, t.subjectRef)],
);

export const signoffs = pgTable(
  "signoffs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    scopeType: text("scope_type").notNull(), // area | line
    scopeId: text("scope_id").notNull(),
    level: text("level").notNull(), // preparer | reviewer | partner
    actorId: text("actor_id").notNull(),
    status: text("status").notNull(), // active | stale | withdrawn
    fingerprint: text("fingerprint").notNull(),
    fingerprintParts: jsonb("fingerprint_parts").$type<Record<string, string>>().notNull(),
    revision: integer("revision").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    note: text("note"),
    invalidatedAt: ts("invalidated_at"),
    invalidatedRevision: integer("invalidated_revision"),
    invalidationReason: text("invalidation_reason"),
  },
  (t) => [index("signoffs_workspace_scope_idx").on(t.workspaceId, t.scopeType, t.scopeId)],
);

/** Who prepared which scope. Drives the no-self-review rule across history. */
export const scopeContributions = pgTable(
  "scope_contributions",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    actorId: text("actor_id").notNull(),
    kind: text("kind").notNull(), // adjustment | verification | anchor | finding | assignment
    revision: integer("revision").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("scope_contributions_idx").on(t.workspaceId, t.scopeType, t.scopeId)],
);

/** Logged reveals of sensitive values (never the value itself). */
export const viewEvents = pgTable(
  "view_events",
  {
    id: serial("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    actorId: text("actor_id").notNull(),
    ref: text("ref").notNull(),
    field: text("field").notNull(),
    outcome: text("outcome").notNull(), // revealed | denied
    reason: text("reason"),
    revision: integer("revision").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("view_events_workspace_idx").on(t.workspaceId)],
);
