-- Drop the existing update policy completely
DROP POLICY IF EXISTS "Users can update conversations they participate in" ON public.conversations;

-- Create updated policy with proper USING and WITH CHECK clauses
-- This allows participants to update the conversation (including adding themselves to deleted_for)
CREATE POLICY "Users can update conversations they participate in"
ON public.conversations
FOR UPDATE
USING (auth.uid() = ANY(participants))
WITH CHECK (auth.uid() = ANY(participants));