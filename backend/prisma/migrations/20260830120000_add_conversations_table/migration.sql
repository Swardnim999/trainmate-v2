-- Create conversations table
CREATE TABLE IF NOT EXISTS "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participants" UUID[] NOT NULL,
    "participant_names" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "train_number" TEXT,
    "travel_date" DATE,
    "last_message" TEXT DEFAULT '',
    "last_message_time" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_for" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "check_conversations_participants_length" CHECK (array_length("participants", 1) = 2),
    CONSTRAINT "check_conversations_participants_distinct" CHECK ("participants"[1] <> "participants"[2]),
    CONSTRAINT "check_conversations_train_number_length" CHECK ("train_number" IS NULL OR char_length("train_number") <= 20)
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS "idx_conversations_participants" ON "conversations" USING GIN ("participants");
CREATE INDEX IF NOT EXISTS "idx_conversations_last_message_time" ON "conversations" ("last_message_time" DESC);

-- Tamper Prevention Function & Trigger
CREATE OR REPLACE FUNCTION prevent_conversation_tamper()
RETURNS trigger AS $$
BEGIN
  IF NEW.participants IS DISTINCT FROM OLD.participants
     OR NEW.participant_names IS DISTINCT FROM OLD.participant_names
     OR NEW.train_number IS DISTINCT FROM OLD.train_number
     OR NEW.travel_date IS DISTINCT FROM OLD.travel_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Modifying protected conversation fields is not allowed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_conversation_tamper_trg ON "conversations";
CREATE TRIGGER prevent_conversation_tamper_trg
BEFORE UPDATE ON "conversations"
FOR EACH ROW EXECUTE FUNCTION prevent_conversation_tamper();
