-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

-- Create a helper function to check if user can view a profile
-- This avoids complex nested queries in the policy itself
CREATE OR REPLACE FUNCTION public.can_view_profile(profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    -- Own profile
    auth.uid() = profile_id
    OR EXISTS (
      -- Users with matching journeys (same train + date)
      SELECT 1 FROM journeys j1
      INNER JOIN journeys j2 ON j1.train_number = j2.train_number 
        AND j1.travel_date = j2.travel_date
      WHERE j1.user_id = auth.uid() 
        AND j2.user_id = profile_id
    )
    OR EXISTS (
      -- Users with accepted companion requests
      SELECT 1 FROM requests
      WHERE status = 'accepted'
        AND ((from_user_id = auth.uid() AND to_user_id = profile_id)
             OR (to_user_id = auth.uid() AND from_user_id = profile_id))
    )
    OR EXISTS (
      -- Users in active conversations
      SELECT 1 FROM conversations
      WHERE auth.uid() = ANY(participants)
        AND profile_id = ANY(participants)
    )
  )
$$;

-- Create the new restrictive policy
CREATE POLICY "Users can view contextual profiles" 
ON public.profiles 
FOR SELECT 
USING (can_view_profile(id));

-- Add indexes for better performance on the join queries
CREATE INDEX IF NOT EXISTS idx_journeys_train_date ON public.journeys(train_number, travel_date);
CREATE INDEX IF NOT EXISTS idx_requests_status_users ON public.requests(status, from_user_id, to_user_id);