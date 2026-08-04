-- Fix 1: Clear all existing user_email data from journeys table
-- This prevents email exposure to other users on the same train
UPDATE public.journeys SET user_email = NULL;

-- Fix 2: Create a secure view for profiles that hides email from non-owners
-- The view will show email only to the profile owner
CREATE OR REPLACE VIEW public.profiles_safe
WITH (security_invoker = on)
AS SELECT 
  id,
  created_at,
  updated_at,
  -- Only show email to the owner of the profile
  CASE WHEN auth.uid() = id THEN email ELSE NULL END as email,
  name,
  college,
  gender,
  bio,
  hobbies,
  avatar_url
FROM public.profiles;

-- Grant SELECT on the view to authenticated users
GRANT SELECT ON public.profiles_safe TO authenticated;