
-- Cleanup exploit seed
DELETE FROM public.conversations WHERE id = '11111111-1111-1111-1111-111111111111';

-- Replace realtime SELECT policy on realtime.messages
DROP POLICY IF EXISTS "Authenticated users can receive their conversation messages" ON realtime.messages;

CREATE POLICY "Authenticated users can receive their conversation messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- messages-<conversationId>
  (
    realtime.topic() LIKE 'messages-%'
    AND public.is_conversation_participant(
      NULLIF(replace(realtime.topic(), 'messages-', ''), '')::uuid
    )
  )
  OR
  -- last-read-<conversationId>-<otherUserId> — only participants of that conversation
  (
    realtime.topic() LIKE 'last-read-%'
    AND public.is_conversation_participant(
      substring(realtime.topic() from 11 for 36)::uuid
    )
  )
  OR
  -- per-user conversations updates channel
  (
    realtime.topic() = ('conversations-updates-' || auth.uid()::text)
  )
);
