-- Create requests table
CREATE TABLE IF NOT EXISTS "requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "from_user_id" UUID NOT NULL,
    "from_email" TEXT,
    "from_name" TEXT,
    "to_user_id" UUID NOT NULL,
    "to_email" TEXT,
    "to_name" TEXT,
    "train_number" TEXT,
    "travel_date" DATE,
    "boarding_station" TEXT,
    "destination_station" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_requests_status" CHECK ("status" IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT "check_requests_from_name_length" CHECK ("from_name" IS NULL OR char_length("from_name") <= 100),
    CONSTRAINT "check_requests_to_name_length" CHECK ("to_name" IS NULL OR char_length("to_name") <= 100),
    CONSTRAINT "check_requests_train_number_length" CHECK ("train_number" IS NULL OR char_length("train_number") <= 20),
    CONSTRAINT "check_requests_boarding_station_length" CHECK ("boarding_station" IS NULL OR char_length("boarding_station") <= 200),
    CONSTRAINT "check_requests_destination_station_length" CHECK ("destination_station" IS NULL OR char_length("destination_station") <= 200),
    CONSTRAINT "check_requests_no_self_request" CHECK ("from_user_id" <> "to_user_id")
);

-- Foreign key constraints with CASCADE deletion
ALTER TABLE "requests"
    ADD CONSTRAINT "requests_from_user_id_fkey"
    FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "requests"
    ADD CONSTRAINT "requests_to_user_id_fkey"
    FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Performance indexes
CREATE INDEX IF NOT EXISTS "idx_requests_from_user" ON "requests"("from_user_id");
CREATE INDEX IF NOT EXISTS "idx_requests_to_user" ON "requests"("to_user_id");
CREATE INDEX IF NOT EXISTS "idx_requests_status" ON "requests"("status");
CREATE INDEX IF NOT EXISTS "idx_requests_status_users" ON "requests"("status", "from_user_id", "to_user_id");
CREATE INDEX IF NOT EXISTS "idx_requests_to_user_status" ON "requests"("to_user_id", "status");

-- Trigger for automatic updated_at timestamp management
CREATE OR REPLACE FUNCTION update_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_requests_updated_at ON "requests";
CREATE TRIGGER trg_update_requests_updated_at
BEFORE UPDATE ON "requests"
FOR EACH ROW
EXECUTE FUNCTION update_requests_updated_at();
