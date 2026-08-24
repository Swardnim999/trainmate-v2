-- CreateTable: trains
CREATE TABLE "trains" (
    "train_number" TEXT NOT NULL,
    "train_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trains_pkey" PRIMARY KEY ("train_number")
);

-- CreateTable: journeys
CREATE TABLE "journeys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "user_name" TEXT,
    "train_number" TEXT NOT NULL,
    "train_name" TEXT,
    "travel_date" DATE NOT NULL,
    "coach" TEXT,
    "boarding_station" TEXT,
    "destination_station" TEXT,
    "college" TEXT,
    "gender" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable: unverified_trains
CREATE TABLE "unverified_trains" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "train_number" TEXT NOT NULL,
    "train_name" TEXT,
    "submitted_by" UUID,
    "entered_value" TEXT,
    "normalized_value" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unverified_trains_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey: journeys -> users
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: unverified_trains -> users
ALTER TABLE "unverified_trains" ADD CONSTRAINT "unverified_trains_submitted_by_fkey"
    FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add check constraints matching historical schema
ALTER TABLE "journeys" ADD CONSTRAINT "check_user_name_length"
    CHECK ("user_name" IS NULL OR char_length("user_name") <= 100);

ALTER TABLE "journeys" ADD CONSTRAINT "check_train_number_length"
    CHECK (char_length("train_number") <= 20);

ALTER TABLE "journeys" ADD CONSTRAINT "check_coach_length"
    CHECK ("coach" IS NULL OR char_length("coach") <= 50);

ALTER TABLE "journeys" ADD CONSTRAINT "check_boarding_station_length"
    CHECK ("boarding_station" IS NULL OR char_length("boarding_station") <= 200);

ALTER TABLE "journeys" ADD CONSTRAINT "check_destination_station_length"
    CHECK ("destination_station" IS NULL OR char_length("destination_station") <= 200);

ALTER TABLE "journeys" ADD CONSTRAINT "check_college_length"
    CHECK ("college" IS NULL OR char_length("college") <= 200);

-- Create Indexes
CREATE INDEX "journeys_user_id_idx" ON "journeys"("user_id");
CREATE INDEX "journeys_train_number_travel_date_idx" ON "journeys"("train_number", "travel_date");
CREATE INDEX "unverified_trains_submitted_by_idx" ON "unverified_trains"("submitted_by");
