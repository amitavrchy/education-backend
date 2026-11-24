-- DropForeignKey
ALTER TABLE "academic_years" DROP CONSTRAINT "academic_years_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_actor_id_fkey";

-- DropForeignKey
ALTER TABLE "books" DROP CONSTRAINT "books_source_file_id_fkey";

-- DropForeignKey
ALTER TABLE "books" DROP CONSTRAINT "books_subject_id_fkey";

-- DropForeignKey
ALTER TABLE "chapters" DROP CONSTRAINT "chapters_book_id_fkey";

-- DropForeignKey
ALTER TABLE "institutions" DROP CONSTRAINT "institutions_board_id_fkey";

-- DropForeignKey
ALTER TABLE "parent_profiles" DROP CONSTRAINT "parent_profiles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "parent_student_links" DROP CONSTRAINT "parent_student_links_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "parent_student_links" DROP CONSTRAINT "parent_student_links_student_id_fkey";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_role_id_fkey";

-- DropForeignKey
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "stored_files" DROP CONSTRAINT "stored_files_uploaded_by_id_fkey";

-- DropForeignKey
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_board_id_fkey";

-- DropForeignKey
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_class_id_fkey";

-- DropForeignKey
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_group_id_fkey";

-- DropForeignKey
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "student_profiles" DROP CONSTRAINT "student_profiles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_class_id_fkey";

-- DropForeignKey
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_group_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_assignments" DROP CONSTRAINT "teacher_assignments_academic_year_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_assignments" DROP CONSTRAINT "teacher_assignments_class_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_assignments" DROP CONSTRAINT "teacher_assignments_group_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_assignments" DROP CONSTRAINT "teacher_assignments_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_assignments" DROP CONSTRAINT "teacher_assignments_subject_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_assignments" DROP CONSTRAINT "teacher_assignments_teacher_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_profiles" DROP CONSTRAINT "teacher_profiles_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "teacher_profiles" DROP CONSTRAINT "teacher_profiles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "topics" DROP CONSTRAINT "topics_chapter_id_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_institution_id_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_role_id_fkey";

-- DropForeignKey
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "user_sessions" DROP CONSTRAINT "user_sessions_user_id_fkey";

-- DropIndex
DROP INDEX "users_status_idx";

-- AlterTable
ALTER TABLE "stored_files" ALTER COLUMN "uploaded_by_id" SET DATA TYPE VARCHAR(120),
ALTER COLUMN "institution_id" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "remember" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "user_id" SET DATA TYPE VARCHAR(120);

-- AlterTable
ALTER TABLE "users" DROP CONSTRAINT "users_pkey",
DROP COLUMN "email_verified_at",
DROP COLUMN "phone_verified_at",
ADD COLUMN     "institution_id" VARCHAR(120),
ADD COLUMN     "name" VARCHAR(200) NOT NULL,
ADD COLUMN     "role" VARCHAR(40) NOT NULL,
ALTER COLUMN "id" SET DATA TYPE VARCHAR(120),
DROP COLUMN "status",
ADD COLUMN     "status" VARCHAR(30) NOT NULL DEFAULT 'active',
ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");

-- DropTable
DROP TABLE "academic_years";

-- DropTable
DROP TABLE "audit_logs";

-- DropTable
DROP TABLE "books";

-- DropTable
DROP TABLE "chapters";

-- DropTable
DROP TABLE "classes";

-- DropTable
DROP TABLE "education_boards";

-- DropTable
DROP TABLE "groups";

-- DropTable
DROP TABLE "institutions";

-- DropTable
DROP TABLE "parent_profiles";

-- DropTable
DROP TABLE "parent_student_links";

-- DropTable
DROP TABLE "permissions";

-- DropTable
DROP TABLE "role_permissions";

-- DropTable
DROP TABLE "roles";

-- DropTable
DROP TABLE "student_profiles";

-- DropTable
DROP TABLE "subjects";

-- DropTable
DROP TABLE "teacher_assignments";

-- DropTable
DROP TABLE "teacher_profiles";

-- DropTable
DROP TABLE "topics";

-- DropTable
DROP TABLE "user_roles";

-- DropEnum
DROP TYPE "ExamLevel";

-- DropEnum
DROP TYPE "Gender";

-- DropEnum
DROP TYPE "InstitutionStatus";

-- DropEnum
DROP TYPE "InstitutionType";

-- DropEnum
DROP TYPE "UserStatus";

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR(30) NOT NULL,
    "target" VARCHAR(254) NOT NULL,
    "code_hash" TEXT NOT NULL,
    "payload" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "records" (
    "collection" VARCHAR(80) NOT NULL,
    "scope" VARCHAR(120) NOT NULL DEFAULT '',
    "id" VARCHAR(160) NOT NULL,
    "data" JSONB NOT NULL,
    "owner_id" VARCHAR(120),
    "institution_id" VARCHAR(120),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "records_pkey" PRIMARY KEY ("collection","scope","id")
);

-- CreateTable
CREATE TABLE "documents" (
    "key" VARCHAR(200) NOT NULL,
    "owner_id" VARCHAR(120),
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "otp_challenges_target_purpose_idx" ON "otp_challenges"("target", "purpose");

-- CreateIndex
CREATE INDEX "records_collection_scope_updated_at_idx" ON "records"("collection", "scope", "updated_at");

-- CreateIndex
CREATE INDEX "records_collection_owner_id_idx" ON "records"("collection", "owner_id");

-- CreateIndex
CREATE INDEX "records_collection_institution_id_idx" ON "records"("collection", "institution_id");

-- CreateIndex
CREATE INDEX "documents_owner_id_idx" ON "documents"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refresh_token_hash_key" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_institution_id_idx" ON "users"("institution_id");

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stored_files" ADD CONSTRAINT "stored_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- JSONB containment/equality filters on contract records (filter[key]=value).
CREATE INDEX "records_data_gin_idx" ON "records" USING GIN ("data" jsonb_path_ops);
