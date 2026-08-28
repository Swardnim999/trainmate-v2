-- Create a function to safely append a user ID to the deleted_for array
-- This function runs with SECURITY DEFINER to bypass RLS checks
CREATE OR REPLACE FUNCTION public.soft_delete_conversation(conv_id uuid, user_id_to_add uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only update if the user is a participant
  UPDATE public.conversations
  SET deleted_for = array_append(COALESCE(deleted_for, ARRAY[]::uuid[]), user_id_to_add)
  WHERE id = conv_id
    AND user_id_to_add = ANY(participants)
    AND NOT (user_id_to_add = ANY(COALESCE(deleted_for, ARRAY[]::uuid[])));
END;
$$;