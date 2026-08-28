
-- 1. Drop user_email column from journeys (email leak via can_view_journey policy)
ALTER TABLE public.journeys DROP COLUMN IF EXISTS user_email;

-- 2. Add Realtime channel authorization
-- Enable RLS on realtime.messages (the broadcast/presence/postgres_changes payload table)
--ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to receive realtime events only for conversations they participate in.
-- Topic format used by client subscriptions: "messages-<conversation_id>" and "conversations-updates"
DROP POLICY IF EXISTS "Authenticated users can receive their conversation messages" ON realtime.messages;
CREATE POLICY "Authenticated users can receive their conversation messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Per-conversation channel: messages-<uuid>
  (
    realtime.topic() LIKE 'messages-%'
    AND public.is_conversation_participant(
      NULLIF(replace(realtime.topic(), 'messages-', ''), '')::uuid
    )
  )
  OR
  -- Global conversations updates channel — only authenticated users (further filtered by table RLS)
  realtime.topic() = 'conversations-updates'
);
