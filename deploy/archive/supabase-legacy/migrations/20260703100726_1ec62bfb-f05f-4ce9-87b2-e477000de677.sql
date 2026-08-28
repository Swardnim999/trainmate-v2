
-- 1. profiles_email_via_rls: revoke column SELECT on email; email lives on auth.users for the owner.
REVOKE SELECT (email) ON public.profiles FROM authenticated;
REVOKE SELECT (email) ON public.profiles FROM anon;

-- 2. request_journey_bypass: require both users share a journey on the given train+date.
CREATE OR REPLACE FUNCTION public.users_share_journey(a uuid, b uuid, train text, tdate date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT train IS NOT NULL AND tdate IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.journeys j1
    JOIN public.journeys j2
      ON j1.train_number = j2.train_number
     AND j1.travel_date  = j2.travel_date
    WHERE j1.user_id = a AND j2.user_id = b
      AND j1.train_number = train AND j1.travel_date = tdate
  );
$$;
REVOKE ALL ON FUNCTION public.users_share_journey(uuid,uuid,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_share_journey(uuid,uuid,text,date) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can create requests" ON public.requests;
CREATE POLICY "Users can create requests"
  ON public.requests FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = from_user_id
    AND from_user_id <> to_user_id
    AND NOT public.is_blocked(from_user_id, to_user_id)
    AND public.users_share_journey(from_user_id, to_user_id, train_number, travel_date)
  );

-- 3. conv_creation_unrestricted: match train/date to an accepted request.
CREATE OR REPLACE FUNCTION public.can_create_conversation(parts uuid[], train text, tdate date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    parts IS NOT NULL
    AND array_length(parts, 1) = 2
    AND auth.uid() = ANY(parts)
    AND parts[1] <> parts[2]
    AND NOT public.is_blocked(parts[1], parts[2])
    AND EXISTS (
      SELECT 1 FROM public.requests r
      WHERE r.status = 'accepted'
        AND (
          (r.from_user_id = parts[1] AND r.to_user_id = parts[2])
          OR (r.from_user_id = parts[2] AND r.to_user_id = parts[1])
        )
        AND (train IS NULL OR r.train_number = train)
        AND (tdate IS NULL OR r.travel_date = tdate)
    );
$$;
REVOKE ALL ON FUNCTION public.can_create_conversation(uuid[],text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_create_conversation(uuid[],text,date) TO authenticated, service_role;

DROP POLICY IF EXISTS "Users can create accepted-companion conversations" ON public.conversations;
CREATE POLICY "Users can create accepted-companion conversations"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (public.can_create_conversation(participants, train_number, travel_date));

-- Drop the old single-arg helper now that the policy uses the 3-arg version.
DROP FUNCTION IF EXISTS public.can_create_conversation(uuid[]);

-- 4. conversations_realtime_deleted_for_bypass:
--    Only the user themselves may soft-delete, and only via the SECURITY DEFINER RPC
--    (which sets a session flag the tamper trigger checks). Direct UPDATEs to
--    deleted_for from clients are rejected, preventing any race where another
--    participant could push a deleted_for change through Realtime.

CREATE OR REPLACE FUNCTION public.soft_delete_conversation(conv_id uuid, user_id_to_add uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR user_id_to_add IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Can only soft-delete conversations for yourself';
  END IF;
  PERFORM set_config('app.allow_deleted_for_update', 'on', true);
  UPDATE public.conversations
  SET deleted_for = array_append(COALESCE(deleted_for, ARRAY[]::uuid[]), user_id_to_add)
  WHERE id = conv_id
    AND user_id_to_add = ANY(participants)
    AND NOT (user_id_to_add = ANY(COALESCE(deleted_for, ARRAY[]::uuid[])));
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_conversation_tamper()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.participants IS DISTINCT FROM OLD.participants
     OR NEW.participant_names IS DISTINCT FROM OLD.participant_names
     OR NEW.train_number IS DISTINCT FROM OLD.train_number
     OR NEW.travel_date IS DISTINCT FROM OLD.travel_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Modifying protected conversation fields is not allowed';
  END IF;
  IF NEW.deleted_for IS DISTINCT FROM OLD.deleted_for
     AND coalesce(current_setting('app.allow_deleted_for_update', true), '') <> 'on' THEN
    RAISE EXCEPTION 'deleted_for can only be modified via soft_delete_conversation()';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_conversation_tamper_trg ON public.conversations;
CREATE TRIGGER prevent_conversation_tamper_trg
BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.prevent_conversation_tamper();

-- 5. Hide backend tables from PostgREST GraphQL surface (keeps REST/RLS intact).
--    Public trains catalog remains visible.
COMMENT ON TABLE public.profiles           IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.conversations      IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.messages           IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.requests           IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.journeys           IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.blocked_users      IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.last_read          IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.user_reports       IS E'@graphql({"visible": false})';
COMMENT ON TABLE public.unverified_trains  IS E'@graphql({"visible": false})';
