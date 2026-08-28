-- Drop existing overly permissive policy
DROP POLICY IF EXISTS "Users can view all journeys" ON public.journeys;

-- Create function to check if user has a journey with matching train/date
CREATE OR REPLACE FUNCTION public.can_view_journey(journey_train_number text, journey_travel_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.journeys
    WHERE user_id = auth.uid()
    AND train_number = journey_train_number
    AND travel_date = journey_travel_date
  )
$$;

-- Create new restrictive policy - users can view their own journeys OR journeys matching their train/date
CREATE POLICY "Users can view own journeys or matching journeys"
ON public.journeys
FOR SELECT
USING (
  auth.uid() = user_id 
  OR public.can_view_journey(train_number, travel_date)
);