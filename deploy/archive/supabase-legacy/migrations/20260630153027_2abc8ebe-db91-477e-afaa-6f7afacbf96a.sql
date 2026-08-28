
-- Defense-in-depth: restrict UPDATE privilege to only the safe columns.
-- The conversations_prevent_tamper trigger remains as a second guard.

REVOKE UPDATE ON public.conversations FROM authenticated;
REVOKE UPDATE ON public.conversations FROM anon;

GRANT UPDATE (last_message, last_message_time, deleted_for)
  ON public.conversations TO authenticated;

-- service_role keeps full access (used by edge functions / admin paths)
GRANT ALL ON public.conversations TO service_role;
