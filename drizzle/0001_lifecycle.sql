CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" text NOT NULL,
	"encoding" text NOT NULL,
	"provenance" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"request_id" text,
	"linked_refs" jsonb NOT NULL,
	"business_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"person_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"presentation_hash" text NOT NULL,
	"status" text NOT NULL,
	"simulated_signature" boolean DEFAULT true NOT NULL,
	"signed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"invalidated_revision" integer,
	"invalidation_reason" text
);
--> statement-breakpoint
CREATE TABLE "dispositions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"subject_ref" text NOT NULL,
	"disposition" text NOT NULL,
	"note" text,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"batch_id" text,
	"withdrawn_revision" integer,
	"withdrawn_by" text
);
--> statement-breakpoint
CREATE TABLE "filing_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"revision" integer NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"business_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "judgments" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject_ref" text NOT NULL,
	"area" text NOT NULL,
	"title" text NOT NULL,
	"authority" text NOT NULL,
	"applicability" text NOT NULL,
	"conclusion" text NOT NULL,
	"consequences" text,
	"evidence_refs" jsonb NOT NULL,
	"checklist" jsonb,
	"status" text NOT NULL,
	"supersedes_id" text,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"recipient_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"refs" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "request_replies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"request_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"attachment_ids" jsonb NOT NULL,
	"business_time" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"from_actor_id" text NOT NULL,
	"to_actor_id" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text NOT NULL,
	"refs" jsonb NOT NULL,
	"area" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"business_time" timestamp with time zone NOT NULL,
	"resolved_by" text,
	"resolved_revision" integer,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "standards_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"version" integer NOT NULL,
	"standards" jsonb NOT NULL,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"jurisdiction" text NOT NULL,
	"attempt" integer NOT NULL,
	"submission_ref" text NOT NULL,
	"status" text NOT NULL,
	"errors" jsonb NOT NULL,
	"simulated" boolean DEFAULT true NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"decided_revision" integer
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"owner_id" text NOT NULL,
	"due_at" timestamp with time zone,
	"status" text NOT NULL,
	"refs" jsonb NOT NULL,
	"area" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL,
	"completed_by" text,
	"completed_revision" integer,
	"completion_note" text,
	"completion_refs" jsonb
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"area" text NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"note" text,
	"work_date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_revision" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "withdrawn_revision" integer;--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "withdrawn_by" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "parent_workspace_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "amends_snapshot_id" text;--> statement-breakpoint
CREATE INDEX "attachments_workspace_idx" ON "attachments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "client_approvals_workspace_idx" ON "client_approvals" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "dispositions_workspace_idx" ON "dispositions" USING btree ("workspace_id","subject_ref");--> statement-breakpoint
CREATE INDEX "filing_snapshots_workspace_idx" ON "filing_snapshots" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "judgments_workspace_idx" ON "judgments" USING btree ("workspace_id","subject_ref");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("workspace_id","recipient_id");--> statement-breakpoint
CREATE INDEX "request_replies_request_idx" ON "request_replies" USING btree ("workspace_id","request_id");--> statement-breakpoint
CREATE INDEX "requests_workspace_idx" ON "requests" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "standards_versions_workspace_idx" ON "standards_versions" USING btree ("workspace_id","version");--> statement-breakpoint
CREATE INDEX "submissions_workspace_idx" ON "submissions" USING btree ("workspace_id","jurisdiction");--> statement-breakpoint
CREATE INDEX "tasks_workspace_idx" ON "tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "time_entries_workspace_idx" ON "time_entries" USING btree ("workspace_id","area");