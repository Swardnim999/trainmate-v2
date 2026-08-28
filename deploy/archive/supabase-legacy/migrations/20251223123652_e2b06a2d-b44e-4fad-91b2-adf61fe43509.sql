-- Add entered_value and normalized_value columns to unverified_trains
ALTER TABLE public.unverified_trains 
ADD COLUMN IF NOT EXISTS entered_value text,
ADD COLUMN IF NOT EXISTS normalized_value text;