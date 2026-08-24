-- CreateTable
CREATE TABLE "profiles" (
    "id" UUID NOT NULL,
    "name" TEXT,
    "bio" TEXT,
    "hobbies" TEXT,
    "college" TEXT,
    "gender" TEXT,
    "avatar_url" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Profile field length constraints matching historical schema
ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_name_length"
    CHECK ("name" IS NULL OR char_length("name") <= 100);

ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_bio_length"
    CHECK ("bio" IS NULL OR char_length("bio") <= 500);

ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_hobbies_length"
    CHECK ("hobbies" IS NULL OR char_length("hobbies") <= 200);

ALTER TABLE "profiles" ADD CONSTRAINT "check_profile_college_length"
    CHECK ("college" IS NULL OR char_length("college") <= 200);

-- Trigger to auto-update updated_at timestamp on updates
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON "profiles"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
