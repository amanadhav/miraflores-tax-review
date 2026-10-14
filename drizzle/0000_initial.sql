CREATE TABLE "adjustments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"target_ref" text NOT NULL,
	"baseline_version" text NOT NULL,
	"area" text NOT NULL,
	"kind" text NOT NULL,
	"prior_value" jsonb,
	"proposed_value" jsonb,
	"prior_label" text,
	"proposed_label" text,
	"reason" text NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"category" text,
	"measure_delta" numeric(16, 2),
	"ca_source" boolean DEFAULT false NOT NULL,
	"effect_federal" numeric(16, 2),
	"effect_california" numeric(16, 2),
	"effect_status" text NOT NULL,
	"effect_basis" text,
	"limitations" jsonb NOT NULL,
	"requires_partner" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"author_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decided_revision" integer,
	"decision_note" text,
	"supersedes_id" text,
	"reverts_id" text
);
--> statement-breakpoint
CREATE TABLE "anchors" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_ref" text NOT NULL,
	"document_id" text NOT NULL,
	"page" integer NOT NULL,
	"text_span" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"origin" text NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"revision" integer NOT NULL,
	"command_id" text,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"area" text,
	"business_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"workspace_id" text NOT NULL,
	"id" text NOT NULL,
	"actor_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"revision_before" integer NOT NULL,
	"revision_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commands_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "document_pages" (
	"packet_id" text NOT NULL,
	"document_id" text NOT NULL,
	"page" integer NOT NULL,
	"printed_content" text NOT NULL,
	CONSTRAINT "document_pages_packet_id_document_id_page_pk" PRIMARY KEY("packet_id","document_id","page")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"packet_id" text NOT NULL,
	"id" text NOT NULL,
	"title" text NOT NULL,
	"document_type" text NOT NULL,
	"issuer" text NOT NULL,
	"belongs_to" text NOT NULL,
	"tax_year" integer NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"uploaded_by" text NOT NULL,
	"file_name" text NOT NULL,
	"page_count" integer NOT NULL,
	"marked_corrected" boolean,
	"extraction_status" text NOT NULL,
	"extraction_values" integer NOT NULL,
	"extraction_reason" text,
	CONSTRAINT "documents_packet_id_id_pk" PRIMARY KEY("packet_id","id")
);
--> statement-breakpoint
CREATE TABLE "extracted_values" (
	"packet_id" text NOT NULL,
	"id" text NOT NULL,
	"document_id" text NOT NULL,
	"page" integer NOT NULL,
	"field" text NOT NULL,
	"label" text NOT NULL,
	"value" jsonb,
	"value_type" text NOT NULL,
	"text_as_read" text NOT NULL,
	"position" jsonb NOT NULL,
	"confidence" real NOT NULL,
	CONSTRAINT "extracted_values_packet_id_id_pk" PRIMARY KEY("packet_id","id")
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"origin" text NOT NULL,
	"code" text,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"refs" jsonb NOT NULL,
	"area" text NOT NULL,
	"blocks_filing" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"owner_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"engine_version" text,
	"fingerprint" text,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolved_revision" integer,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "packets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"generated" text NOT NULL,
	"client_id" text NOT NULL,
	"byte_length" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_edges" (
	"id" serial PRIMARY KEY NOT NULL,
	"packet_id" text NOT NULL,
	"workspace_id" text,
	"version" text,
	"from_ref" text NOT NULL,
	"to_ref" text NOT NULL,
	"relation" text NOT NULL,
	"origin" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_lines" (
	"packet_id" text NOT NULL,
	"version" text NOT NULL,
	"key" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"form" text NOT NULL,
	"line" text NOT NULL,
	"label" text NOT NULL,
	"value" jsonb,
	"rule" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"note" text,
	CONSTRAINT "return_lines_packet_id_version_key_pk" PRIMARY KEY("packet_id","version","key")
);
--> statement-breakpoint
CREATE TABLE "scope_contributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seen_cursors" (
	"workspace_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"revision" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seen_cursors_workspace_id_actor_id_pk" PRIMARY KEY("workspace_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"level" text NOT NULL,
	"actor_id" text NOT NULL,
	"status" text NOT NULL,
	"fingerprint" text NOT NULL,
	"fingerprint_parts" jsonb NOT NULL,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"invalidated_at" timestamp with time zone,
	"invalidated_revision" integer,
	"invalidation_reason" text
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_ref" text NOT NULL,
	"area" text NOT NULL,
	"method" text NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"conclusion" text NOT NULL,
	"note" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "view_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"ref" text NOT NULL,
	"field" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"revision" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"packet_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"active_version" text NOT NULL,
	"workflow_state" text DEFAULT 'preparing' NOT NULL,
	"filing_locked" boolean DEFAULT false NOT NULL,
	"assigned_preparer" text NOT NULL,
	"assigned_reviewer" text NOT NULL,
	"assigned_partner" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "adjustments_workspace_target_idx" ON "adjustments" USING btree ("workspace_id","target_ref");--> statement-breakpoint
CREATE INDEX "anchors_workspace_subject_idx" ON "anchors" USING btree ("workspace_id","subject_ref");--> statement-breakpoint
CREATE INDEX "audit_events_workspace_rev_idx" ON "audit_events" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE INDEX "documents_received_idx" ON "documents" USING btree ("packet_id","received_at");--> statement-breakpoint
CREATE INDEX "extracted_values_page_idx" ON "extracted_values" USING btree ("packet_id","document_id","page");--> statement-breakpoint
CREATE INDEX "findings_workspace_status_idx" ON "findings" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "reference_edges_from_idx" ON "reference_edges" USING btree ("packet_id","from_ref");--> statement-breakpoint
CREATE INDEX "reference_edges_to_idx" ON "reference_edges" USING btree ("packet_id","to_ref");--> statement-breakpoint
CREATE INDEX "reference_edges_workspace_idx" ON "reference_edges" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "return_lines_form_idx" ON "return_lines" USING btree ("packet_id","version","form");--> statement-breakpoint
CREATE INDEX "scope_contributions_idx" ON "scope_contributions" USING btree ("workspace_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "signoffs_workspace_scope_idx" ON "signoffs" USING btree ("workspace_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "verifications_workspace_subject_idx" ON "verifications" USING btree ("workspace_id","subject_ref");--> statement-breakpoint
CREATE INDEX "view_events_workspace_idx" ON "view_events" USING btree ("workspace_id");