-- Product decision (frontend b059514): schools/colleges are no longer onboarded as clients and
-- under-18 students no longer need guardian consent. Data-only migration; no schema change.

-- Institution admin accounts: soft-delete and end their sessions.
UPDATE "user_sessions" SET "revoked_at" = now()
  WHERE "revoked_at" IS NULL AND "user_id" IN (SELECT "id" FROM "users" WHERE "role" IN ('school_admin', 'college_admin'));
UPDATE "users" SET "deleted_at" = now(), "status" = 'pending_deletion'
  WHERE "role" IN ('school_admin', 'college_admin') AND "deleted_at" IS NULL;
DELETE FROM "records" WHERE "collection" = 'users' AND "data"->>'role' IN ('school_admin', 'college_admin');

-- Guardian consent records and consent fields.
DELETE FROM "records" WHERE "collection" = 'consentRecords';
UPDATE "records" SET "data" = "data" - 'consent' WHERE "collection" = 'users' AND "data" ? 'consent';
UPDATE "documents" SET "data" = "data" - 'minAgeWithoutConsent' WHERE "key" = 'systemConfig';

-- Institution plan; institution-only coupons are deactivated.
DELETE FROM "records" WHERE "collection" = 'plans' AND "data"->>'code' = 'institution';
UPDATE "records" SET "data" = jsonb_set("data", '{active}', 'false')
  WHERE "collection" = 'coupons' AND "data"->'planCodes' = '["institution"]'::jsonb;

-- Institution notifications and roles in the editable permission matrix.
DELETE FROM "records" WHERE "collection" = 'notifications' AND "data"->>'portal' = 'institution';
UPDATE "documents" SET "data" = jsonb_set("data", '{matrix}', ("data"->'matrix') - 'school_admin' - 'college_admin')
  WHERE "key" = 'permissionMatrix' AND "data" ? 'matrix';
