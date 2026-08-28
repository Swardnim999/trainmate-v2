-- Fix 1: Add DELETE policy for profiles (profiles_delete_policy)
CREATE POLICY "Users can delete own profile"
ON public.profiles
FOR DELETE
USING (auth.uid() = id);

-- Fix 2: Integrate is_blocked() into RLS policies (blocking_not_enforced)

-- 2a. Update journeys SELECT policy to check blocking
DROP POLICY IF EXISTS "Users can view own journeys or matching journeys" ON public.journeys;
CREATE POLICY "Users can view own journeys or matching journeys"
ON public.journeys
FOR SELECT
USING (
  auth.uid() = user_id 
  OR (
    public.can_view_journey(train_number, travel_date)
    AND NOT public.is_blocked(auth.uid(), user_id)
  )
);

-- 2b. Update requests INSERT policy to prevent sending to blocked users
DROP POLICY IF EXISTS "Users can create requests" ON public.requests;
CREATE POLICY "Users can create requests"
ON public.requests
FOR INSERT
WITH CHECK (
  auth.uid() = from_user_id
  AND NOT public.is_blocked(from_user_id, to_user_id)
);

-- 2c. Update requests SELECT policy to hide requests involving blocked users
DROP POLICY IF EXISTS "Users can view requests they sent or received" ON public.requests;
CREATE POLICY "Users can view requests they sent or received"
ON public.requests
FOR SELECT
USING (
  (auth.uid() = from_user_id OR auth.uid() = to_user_id)
  AND NOT public.is_blocked(from_user_id, to_user_id)
);

-- 2d. Update can_view_profile function to check blocking
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
    OR (
      -- Not blocked AND has contextual relationship
      NOT public.is_blocked(auth.uid(), profile_id)
      AND (
        EXISTS (
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
    )
  )
$$;

-- 2e. Add index for blocked_users lookups for better performance
CREATE INDEX IF NOT EXISTS idx_blocked_users_lookup 
ON blocked_users(blocker_id, blocked_id);

-- Fix 3: Make avatars bucket private (avatar_public_bucket)
UPDATE storage.buckets 
SET public = false 
WHERE id = 'avatars';

-- Drop old public SELECT policy
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;

-- Create authenticated-only SELECT policy
CREATE POLICY "Authenticated users can view avatars"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'avatars');

-- Fix 4: Add database constraints for journey validation (journey_form_validation)
ALTER TABLE public.journeys
ADD CONSTRAINT check_user_name_length CHECK (user_name IS NULL OR char_length(user_name) <= 100);

ALTER TABLE public.journeys
ADD CONSTRAINT check_train_number_length CHECK (char_length(train_number) <= 20);

ALTER TABLE public.journeys
ADD CONSTRAINT check_coach_length CHECK (coach IS NULL OR char_length(coach) <= 50);

ALTER TABLE public.journeys
ADD CONSTRAINT check_boarding_station_length CHECK (boarding_station IS NULL OR char_length(boarding_station) <= 200);

ALTER TABLE public.journeys
ADD CONSTRAINT check_destination_station_length CHECK (destination_station IS NULL OR char_length(destination_station) <= 200);

ALTER TABLE public.journeys
ADD CONSTRAINT check_college_length CHECK (college IS NULL OR char_length(college) <= 200);

-- Fix 5: Add constraints for profiles table as well
ALTER TABLE public.profiles
ADD CONSTRAINT check_profile_name_length CHECK (name IS NULL OR char_length(name) <= 100);

ALTER TABLE public.profiles
ADD CONSTRAINT check_profile_bio_length CHECK (bio IS NULL OR char_length(bio) <= 500);

ALTER TABLE public.profiles
ADD CONSTRAINT check_profile_hobbies_length CHECK (hobbies IS NULL OR char_length(hobbies) <= 200);

ALTER TABLE public.profiles
ADD CONSTRAINT check_profile_college_length CHECK (college IS NULL OR char_length(college) <= 200);