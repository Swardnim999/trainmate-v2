
-- 1) Prevent tampering of immutable conversation fields
CREATE OR REPLACE FUNCTION public.prevent_conversation_tamper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
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
$$;

DROP TRIGGER IF EXISTS conversations_prevent_tamper ON public.conversations;
CREATE TRIGGER conversations_prevent_tamper
BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.prevent_conversation_tamper();

-- 2) Helper: check if the caller is blocked by/blocking any other participant in conversation
CREATE OR REPLACE FUNCTION public.is_blocked_in_conversation(conv_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c, unnest(c.participants) AS p
    WHERE c.id = conv_id
      AND p <> uid
      AND public.is_blocked(uid, p)
  )
$$;

-- 3) Helper: validate that conversation creation is allowed (accepted request + no block, 2 participants)
CREATE OR REPLACE FUNCTION public.can_create_conversation(parts uuid[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    parts IS NOT NULL
    AND array_length(parts, 1) = 2
    AND auth.uid() = ANY(parts)
    AND NOT public.is_blocked(parts[1], parts[2])
    AND EXISTS (
      SELECT 1 FROM public.requests r
      WHERE r.status = 'accepted'
        AND (
          (r.from_user_id = parts[1] AND r.to_user_id = parts[2])
          OR (r.from_user_id = parts[2] AND r.to_user_id = parts[1])
        )
    )
$$;

-- 4) Tighten conversations INSERT policy: require accepted companion + no block
DROP POLICY IF EXISTS "Users can create conversations they participate in" ON public.conversations;
CREATE POLICY "Users can create accepted-companion conversations"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (public.can_create_conversation(participants));

-- 5) Block enforcement on messages INSERT
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND public.is_conversation_participant(conversation_id)
  AND NOT public.is_blocked_in_conversation(conversation_id, auth.uid())
);

-- 6) Realtime: scope the conversations-updates broadcast topic per user
DROP POLICY IF EXISTS "Authenticated users can receive their conversation messages" ON realtime.messages;
CREATE POLICY "Authenticated users can receive their conversation messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (
    realtime.topic() LIKE 'messages-%'
    AND public.is_conversation_participant(
      (NULLIF(replace(realtime.topic(), 'messages-', ''), ''))::uuid
    )
  )
  OR (
    realtime.topic() LIKE 'last-read-%'
  )
  OR (
    realtime.topic() = ('conversations-updates-' || auth.uid()::text)
  )
);

-- 7) Storage: add missing UPDATE policy for chat-attachments
CREATE POLICY "Owners can update their chat attachments"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
  AND public.is_conversation_participant((split_part(name, '/', 1))::uuid)
)
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
  AND public.is_conversation_participant((split_part(name, '/', 1))::uuid)
);

-- 8) Lock down SECURITY DEFINER helpers from anon execution
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_view_journey(text, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_view_profile(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.soft_delete_conversation(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_blocked_in_conversation(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_create_conversation(uuid[]) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_journey(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_in_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_conversation(uuid[]) TO authenticated;
