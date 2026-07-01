CREATE TABLE "work"."labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(20) DEFAULT '#6b7280' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work"."work_item_labels" (
	"work_item_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_labels_work_item_id_label_id_pk" PRIMARY KEY("work_item_id","label_id")
);
--> statement-breakpoint
CREATE INDEX "ix_labels_tenant" ON "work"."labels" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ix_labels_project" ON "work"."labels" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_labels_name" ON "work"."labels" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "ix_wil_work_item" ON "work"."work_item_labels" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "ix_wil_label" ON "work"."work_item_labels" USING btree ("label_id");