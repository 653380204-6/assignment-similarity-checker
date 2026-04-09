


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cleanup_old_cache"("days_old" integer DEFAULT 30) RETURNS TABLE("deleted_count" bigint)
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    RETURN QUERY
    WITH deleted AS (
        DELETE FROM processed_files
        WHERE last_used_at < NOW() - (days_old || ' days')::INTERVAL
        RETURNING *
    )
    SELECT COUNT(*)::BIGINT FROM deleted;
END;
$$;


ALTER FUNCTION "public"."cleanup_old_cache"("days_old" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_missing_document_pairs"("p_batch_id" "text", "p_new_doc_ids" "text"[]) RETURNS TABLE("doc_id_1" "text", "doc_id_2" "text", "pair_key" "text")
    LANGUAGE "sql"
    AS $$
WITH new_docs AS (
  SELECT DISTINCT unnest(p_new_doc_ids) AS doc_id
),
all_docs AS (
  SELECT DISTINCT d.doc_id
  FROM public.documents_duplicate d
  WHERE d.batch_id = p_batch_id
    AND COALESCE(d.status, 'success') = 'success'
),
old_docs AS (
  SELECT a.doc_id
  FROM all_docs a
  LEFT JOIN new_docs n
    ON n.doc_id = a.doc_id
  WHERE n.doc_id IS NULL
),
candidate_pairs AS (
  SELECT
    LEAST(n.doc_id, o.doc_id) AS doc_id_1,
    GREATEST(n.doc_id, o.doc_id) AS doc_id_2
  FROM new_docs n
  CROSS JOIN old_docs o

  UNION

  SELECT
    LEAST(n1.doc_id, n2.doc_id) AS doc_id_1,
    GREATEST(n1.doc_id, n2.doc_id) AS doc_id_2
  FROM new_docs n1
  JOIN new_docs n2
    ON n1.doc_id < n2.doc_id
),
dedup AS (
  SELECT DISTINCT
    c.doc_id_1,
    c.doc_id_2,
    c.doc_id_1 || '__' || c.doc_id_2 AS pair_key
  FROM candidate_pairs c
)
SELECT
  d.doc_id_1,
  d.doc_id_2,
  d.pair_key
FROM dedup d
LEFT JOIN public.document_pairs p
  ON p.batch_id = p_batch_id
 AND p.pair_key = d.pair_key
WHERE p.id IS NULL
ORDER BY d.doc_id_1, d.doc_id_2;
$$;


ALTER FUNCTION "public"."get_missing_document_pairs"("p_batch_id" "text", "p_new_doc_ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public."User" (auth_uid, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (auth_uid) DO NOTHING;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_file_usage"("hash" "text", "mode" integer) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    UPDATE processed_files
    SET 
        use_count = use_count + 1,
        last_used_at = NOW()
    WHERE file_hash = hash 
      AND processing_mode = mode;
END;
$$;


ALTER FUNCTION "public"."increment_file_usage"("hash" "text", "mode" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."User" (
    "auth_uid" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text"
);


ALTER TABLE "public"."User" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."batch_files" (
    "id" integer NOT NULL,
    "batch_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "file_hash" character varying(64) NOT NULL,
    "processing_mode" integer NOT NULL,
    "doc_id" "text" NOT NULL,
    "filename" character varying(255) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."batch_files" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."batch_files_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."batch_files_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."batch_files_id_seq" OWNED BY "public"."batch_files"."id";



CREATE TABLE IF NOT EXISTS "public"."batches" (
    "batch_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "processing_mode" integer NOT NULL,
    "use_template" boolean DEFAULT false NOT NULL,
    "template_doc_id" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "template_storage_path" "text",
    CONSTRAINT "batches_processing_mode_check" CHECK (("processing_mode" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "batches_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_pairs" (
    "id" bigint NOT NULL,
    "batch_id" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "doc_id_1" "text" NOT NULL,
    "doc_id_2" "text" NOT NULL,
    "pair_key" "text" GENERATED ALWAYS AS (((LEAST("doc_id_1", "doc_id_2") || '__'::"text") || GREATEST("doc_id_1", "doc_id_2"))) STORED,
    "processing_mode" integer NOT NULL,
    "text_score" double precision,
    "image_score" double precision,
    "final_score" double precision NOT NULL,
    "status" "text" DEFAULT 'success'::"text" NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "semantic_score" double precision,
    "lexical_score" double precision,
    "image_cosine_avg" double precision,
    "image_phash_avg" double precision,
    "matched_images" integer,
    "total_images" integer,
    CONSTRAINT "chk_document_pairs_different_docs" CHECK (("doc_id_1" <> "doc_id_2")),
    CONSTRAINT "document_pairs_processing_mode_check" CHECK (("processing_mode" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "document_pairs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'success'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."document_pairs" OWNER TO "postgres";


ALTER TABLE "public"."document_pairs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."document_pairs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."documents_duplicate" (
    "id" bigint NOT NULL,
    "file_name" "text" NOT NULL,
    "doc_id" "text",
    "storage_path" "text",
    "user_id" "uuid",
    "status" "text",
    "processing_mode" integer,
    "text_length" bigint,
    "image_count" integer DEFAULT 0,
    "removed_text_length" bigint,
    "error" "text",
    "created_at" timestamp without time zone DEFAULT "now"(),
    "batch_id" "text",
    "file_hash" "text"
);


ALTER TABLE "public"."documents_duplicate" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."documents_duplicate_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."documents_duplicate_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."documents_duplicate_id_seq" OWNED BY "public"."documents_duplicate"."id";



CREATE OR REPLACE VIEW "public"."v_compare_results" AS
 SELECT "p"."id",
    "p"."batch_id",
    "p"."user_id",
    "p"."doc_id_1" AS "doc_1",
    "d1"."file_name" AS "doc_1_name",
    "d1"."storage_path" AS "doc_1_storage_path",
    "p"."doc_id_2" AS "doc_2",
    "d2"."file_name" AS "doc_2_name",
    "d2"."storage_path" AS "doc_2_storage_path",
    "p"."text_score",
    "p"."image_score",
    "p"."final_score",
    "p"."processing_mode",
    "p"."status",
    "p"."error",
    "p"."created_at",
    "p"."updated_at"
   FROM (("public"."document_pairs" "p"
     LEFT JOIN "public"."documents_duplicate" "d1" ON ((("d1"."batch_id" = "p"."batch_id") AND ("d1"."doc_id" = "p"."doc_id_1"))))
     LEFT JOIN "public"."documents_duplicate" "d2" ON ((("d2"."batch_id" = "p"."batch_id") AND ("d2"."doc_id" = "p"."doc_id_2"))));


ALTER VIEW "public"."v_compare_results" OWNER TO "postgres";


ALTER TABLE ONLY "public"."batch_files" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."batch_files_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."documents_duplicate" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."documents_duplicate_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."batch_files"
    ADD CONSTRAINT "batch_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."batch_files"
    ADD CONSTRAINT "batch_files_unique" UNIQUE ("batch_id", "user_id", "doc_id", "processing_mode");



ALTER TABLE ONLY "public"."batch_files"
    ADD CONSTRAINT "batch_files_unique_batch_doc_mode" UNIQUE ("batch_id", "doc_id", "processing_mode");



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "batches_pkey" PRIMARY KEY ("batch_id");



ALTER TABLE ONLY "public"."document_pairs"
    ADD CONSTRAINT "document_pairs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents_duplicate"
    ADD CONSTRAINT "documents_duplicate_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents_duplicate"
    ADD CONSTRAINT "documents_duplicate_user_doc_unique" UNIQUE ("user_id", "doc_id");



ALTER TABLE ONLY "public"."User"
    ADD CONSTRAINT "s_db_pkey" PRIMARY KEY ("auth_uid");



ALTER TABLE ONLY "public"."document_pairs"
    ADD CONSTRAINT "uq_document_pairs_batch_pair" UNIQUE ("batch_id", "pair_key");



CREATE INDEX "documents_duplicate_created_idx" ON "public"."documents_duplicate" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "documents_duplicate_user_doc_ux" ON "public"."documents_duplicate" USING "btree" ("user_id", "doc_id");



CREATE INDEX "documents_duplicate_user_idx" ON "public"."documents_duplicate" USING "btree" ("user_id");



CREATE INDEX "idx_batch_files_batch" ON "public"."batch_files" USING "btree" ("batch_id");



CREATE INDEX "idx_batch_files_batch_doc" ON "public"."batch_files" USING "btree" ("batch_id", "doc_id");



CREATE INDEX "idx_batch_files_batch_id" ON "public"."batch_files" USING "btree" ("batch_id");



CREATE INDEX "idx_batch_files_doc_id" ON "public"."batch_files" USING "btree" ("doc_id");



CREATE INDEX "idx_batch_files_hash" ON "public"."batch_files" USING "btree" ("file_hash");



CREATE INDEX "idx_batch_files_user_batch" ON "public"."batch_files" USING "btree" ("user_id", "batch_id");



CREATE INDEX "idx_batch_files_user_id" ON "public"."batch_files" USING "btree" ("user_id");



CREATE INDEX "idx_batches_status" ON "public"."batches" USING "btree" ("status");



CREATE INDEX "idx_batches_user_id" ON "public"."batches" USING "btree" ("user_id");



CREATE INDEX "idx_document_pairs_batch_id" ON "public"."document_pairs" USING "btree" ("batch_id");



CREATE INDEX "idx_document_pairs_batch_score" ON "public"."document_pairs" USING "btree" ("batch_id", "final_score" DESC);



CREATE INDEX "idx_document_pairs_doc_id_1" ON "public"."document_pairs" USING "btree" ("doc_id_1");



CREATE INDEX "idx_document_pairs_doc_id_2" ON "public"."document_pairs" USING "btree" ("doc_id_2");



CREATE INDEX "idx_document_pairs_status" ON "public"."document_pairs" USING "btree" ("status");



CREATE INDEX "idx_document_pairs_user_id" ON "public"."document_pairs" USING "btree" ("user_id");



CREATE INDEX "idx_documents_duplicate_batch_doc" ON "public"."documents_duplicate" USING "btree" ("batch_id", "doc_id");



CREATE INDEX "idx_documents_duplicate_batch_id" ON "public"."documents_duplicate" USING "btree" ("batch_id");



CREATE INDEX "idx_documents_duplicate_doc_id" ON "public"."documents_duplicate" USING "btree" ("doc_id");



CREATE INDEX "idx_documents_duplicate_user_id" ON "public"."documents_duplicate" USING "btree" ("user_id");



CREATE UNIQUE INDEX "uq_batch_files_batch_hash" ON "public"."batch_files" USING "btree" ("batch_id", "file_hash");



CREATE UNIQUE INDEX "uq_documents_duplicate_batch_hash" ON "public"."documents_duplicate" USING "btree" ("batch_id", "file_hash");



CREATE OR REPLACE TRIGGER "trg_batches_updated_at" BEFORE UPDATE ON "public"."batches" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_document_pairs_updated_at" BEFORE UPDATE ON "public"."document_pairs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."batch_files"
    ADD CONSTRAINT "fk_batch_files_auth_user" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."batch_files"
    ADD CONSTRAINT "fk_batch_user" FOREIGN KEY ("user_id") REFERENCES "public"."User"("auth_uid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."batches"
    ADD CONSTRAINT "fk_batches_user" FOREIGN KEY ("user_id") REFERENCES "public"."User"("auth_uid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_pairs"
    ADD CONSTRAINT "fk_document_pairs_batch" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("batch_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_pairs"
    ADD CONSTRAINT "fk_document_pairs_user" FOREIGN KEY ("user_id") REFERENCES "public"."User"("auth_uid") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents_duplicate"
    ADD CONSTRAINT "fk_documents_auth_user" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents_duplicate" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."cleanup_old_cache"("days_old" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_old_cache"("days_old" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_old_cache"("days_old" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_missing_document_pairs"("p_batch_id" "text", "p_new_doc_ids" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_missing_document_pairs"("p_batch_id" "text", "p_new_doc_ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_missing_document_pairs"("p_batch_id" "text", "p_new_doc_ids" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_file_usage"("hash" "text", "mode" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_file_usage"("hash" "text", "mode" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_file_usage"("hash" "text", "mode" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."User" TO "anon";
GRANT ALL ON TABLE "public"."User" TO "authenticated";
GRANT ALL ON TABLE "public"."User" TO "service_role";



GRANT ALL ON TABLE "public"."batch_files" TO "anon";
GRANT ALL ON TABLE "public"."batch_files" TO "authenticated";
GRANT ALL ON TABLE "public"."batch_files" TO "service_role";



GRANT ALL ON SEQUENCE "public"."batch_files_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."batch_files_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."batch_files_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."batches" TO "anon";
GRANT ALL ON TABLE "public"."batches" TO "authenticated";
GRANT ALL ON TABLE "public"."batches" TO "service_role";



GRANT ALL ON TABLE "public"."document_pairs" TO "anon";
GRANT ALL ON TABLE "public"."document_pairs" TO "authenticated";
GRANT ALL ON TABLE "public"."document_pairs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."document_pairs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."document_pairs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."document_pairs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."documents_duplicate" TO "anon";
GRANT ALL ON TABLE "public"."documents_duplicate" TO "authenticated";
GRANT ALL ON TABLE "public"."documents_duplicate" TO "service_role";



GRANT ALL ON SEQUENCE "public"."documents_duplicate_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."documents_duplicate_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."documents_duplicate_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."v_compare_results" TO "anon";
GRANT ALL ON TABLE "public"."v_compare_results" TO "authenticated";
GRANT ALL ON TABLE "public"."v_compare_results" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































