-- Drop the existing update policy
DROP POLICY IF EXISTS "Users can update conversations they participate in" ON public.conversations;

-- Create a new update policy that allows participants to update the conversation
-- The WITH CHECK ensures the update is valid (user remains a participant)
CREATE POLICY "Users can update conversations they participate in"
ON public.conversations
FOR UPDATE
USING (auth.uid() = ANY(participants))
WITH CHECK (auth.uid() = ANY(participants));