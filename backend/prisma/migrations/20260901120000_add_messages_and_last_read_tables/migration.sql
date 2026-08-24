-- Create messages table
CREATE TABLE IF NOT EXISTS "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "sender_name" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attachment_url" TEXT,
    "attachment_type" TEXT,
    "attachment_name" TEXT,
    "attachment_size" BIGINT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "check_messages_content" CHECK (char_length("text") > 0 OR "attachment_url" IS NOT NULL),
    CONSTRAINT "check_messages_text_length" CHECK (char_length("text") <= 2000)
);

-- Performance Indexes on messages
CREATE INDEX IF NOT EXISTS "idx_messages_conversation" ON "messages" ("conversation_id");
CREATE INDEX IF NOT EXISTS "idx_messages_conversation_created_at" ON "messages" ("conversation_id", "created_at" ASC);
CREATE INDEX IF NOT EXISTS "idx_messages_sender" ON "messages" ("sender_id");

-- Create last_read table
CREATE TABLE IF NOT EXISTS "last_read" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "last_read_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "last_read_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "last_read_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "last_read_user_id_conversation_id_key" UNIQUE ("user_id", "conversation_id")
);

-- Performance Indexes on last_read
CREATE INDEX IF NOT EXISTS "idx_last_read_conversation" ON "last_read" ("conversation_id");
