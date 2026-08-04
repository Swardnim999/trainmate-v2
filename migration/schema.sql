-- ==============================================================
-- TrainMate: Consolidated Supabase schema
-- Generated 2026-07-23T20:48:44Z from supabase/migrations/*
-- Includes: schema, RLS policies, triggers, functions, grants,
--           storage buckets & policies, security hardening.
-- Apply against an EMPTY new Supabase project:
--   psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
-- ==============================================================


-- --------------------------------------------------------------
-- 20251212061640_5dc954fa-b976-4b88-b0e4-bdb3250214f5.sql
-- --------------------------------------------------------------

-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  college TEXT,
  gender TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles RLS policies
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Create journeys table
CREATE TABLE public.journeys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  user_name TEXT,
  train_number TEXT NOT NULL,
  travel_date DATE NOT NULL,
  coach TEXT,
  boarding_station TEXT,
  destination_station TEXT,
  college TEXT,
  gender TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on journeys
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;

-- Journeys RLS policies
CREATE POLICY "Users can view all journeys" ON public.journeys
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create own journeys" ON public.journeys
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own journeys" ON public.journeys
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own journeys" ON public.journeys
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Create requests table
CREATE TABLE public.requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_email TEXT,
  from_name TEXT,
  to_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_email TEXT,
  to_name TEXT,
  train_number TEXT,
  travel_date DATE,
  boarding_station TEXT,
  destination_station TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on requests
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;

-- Requests RLS policies
CREATE POLICY "Users can view requests they sent or received" ON public.requests
  FOR SELECT TO authenticated 
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id);

CREATE POLICY "Users can create requests" ON public.requests
  FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = from_user_id);

CREATE POLICY "Users can update requests they received" ON public.requests
  FOR UPDATE TO authenticated 
  USING (auth.uid() = to_user_id);

-- Create conversations table
CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  participants UUID[] NOT NULL,
  participant_names JSONB NOT NULL DEFAULT '{}'::jsonb,
  train_number TEXT,
  travel_date DATE,
  last_message TEXT,
  last_message_time TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- Conversations RLS policies
CREATE POLICY "Users can view conversations they participate in" ON public.conversations
  FOR SELECT TO authenticated 
  USING (auth.uid() = ANY(participants));

CREATE POLICY "Users can create conversations they participate in" ON public.conversations
  FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = ANY(participants));

CREATE POLICY "Users can update conversations they participate in" ON public.conversations
  FOR UPDATE TO authenticated 
  USING (auth.uid() = ANY(participants));

-- Create messages table
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name TEXT,
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on messages
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Messages RLS policies (users can only see messages in their conversations)
CREATE OR REPLACE FUNCTION public.is_conversation_participant(conv_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = conv_id AND auth.uid() = ANY(participants)
  )
$$;

CREATE POLICY "Users can view messages in their conversations" ON public.messages
  FOR SELECT TO authenticated 
  USING (public.is_conversation_participant(conversation_id));

CREATE POLICY "Users can send messages in their conversations" ON public.messages
  FOR INSERT TO authenticated 
  WITH CHECK (auth.uid() = sender_id AND public.is_conversation_participant(conversation_id));

-- Create last_read table for unread tracking
CREATE TABLE public.last_read (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, conversation_id)
);

-- Enable RLS on last_read
ALTER TABLE public.last_read ENABLE ROW LEVEL SECURITY;

-- Last read RLS policies
CREATE POLICY "Users can view own last_read" ON public.last_read
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own last_read" ON public.last_read
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own last_read" ON public.last_read
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_requests_updated_at
  BEFORE UPDATE ON public.requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle new user signup (creates profile automatically)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

-- Trigger to create profile on user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Enable realtime for messages (for real-time chat)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Create indexes for performance
CREATE INDEX idx_journeys_user_id ON public.journeys(user_id);
CREATE INDEX idx_journeys_train_date ON public.journeys(train_number, travel_date);
CREATE INDEX idx_requests_from_user ON public.requests(from_user_id);
CREATE INDEX idx_requests_to_user ON public.requests(to_user_id);
CREATE INDEX idx_requests_status ON public.requests(status);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_conversations_participants ON public.conversations USING GIN(participants);


-- --------------------------------------------------------------
-- 20251212062642_d0b54a4d-212a-4caa-8ead-e3e6c9367400.sql
-- --------------------------------------------------------------

-- Fix function search path mutable warning for update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- --------------------------------------------------------------
-- 20251214131649_42a91877-83fe-44c9-9c80-e8a7658f4320.sql
-- --------------------------------------------------------------
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

-- --------------------------------------------------------------
-- 20251215070131_3ca540b1-5ea5-43cd-bdb1-b8cb7adb1daa.sql
-- --------------------------------------------------------------

-- Add deleted_for column to conversations for soft delete per user
ALTER TABLE public.conversations 
ADD COLUMN deleted_for uuid[] DEFAULT '{}';

-- Create blocked_users table
CREATE TABLE public.blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(blocker_id, blocked_id)
);

-- Enable RLS on blocked_users
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;

-- RLS policies for blocked_users
CREATE POLICY "Users can view their own blocks"
ON public.blocked_users
FOR SELECT
USING (auth.uid() = blocker_id);

CREATE POLICY "Users can block others"
ON public.blocked_users
FOR INSERT
WITH CHECK (auth.uid() = blocker_id);

CREATE POLICY "Users can unblock others"
ON public.blocked_users
FOR DELETE
USING (auth.uid() = blocker_id);

-- Create user_reports table
CREATE TABLE public.user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  reported_id uuid NOT NULL,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS on user_reports
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_reports
CREATE POLICY "Users can create reports"
ON public.user_reports
FOR INSERT
WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users can view their own reports"
ON public.user_reports
FOR SELECT
USING (auth.uid() = reporter_id);

-- Create function to check if user is blocked
CREATE OR REPLACE FUNCTION public.is_blocked(user_a uuid, user_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocked_users
    WHERE (blocker_id = user_a AND blocked_id = user_b)
       OR (blocker_id = user_b AND blocked_id = user_a)
  )
$$;

-- Update conversations RLS to exclude deleted_for
DROP POLICY IF EXISTS "Users can view conversations they participate in" ON public.conversations;
CREATE POLICY "Users can view conversations they participate in"
ON public.conversations
FOR SELECT
USING (
  auth.uid() = ANY(participants) 
  AND NOT (auth.uid() = ANY(COALESCE(deleted_for, '{}')))
);

-- Add policy for updating deleted_for
DROP POLICY IF EXISTS "Users can update conversations they participate in" ON public.conversations;
CREATE POLICY "Users can update conversations they participate in"
ON public.conversations
FOR UPDATE
USING (auth.uid() = ANY(participants));

-- Enable realtime for presence tracking
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;


-- --------------------------------------------------------------
-- 20251217182641_2708c889-71e4-4ec2-9178-75084e9422ec.sql
-- --------------------------------------------------------------
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

-- --------------------------------------------------------------
-- 20251219073900_91965447-9d0f-4bfa-944d-37ebb29dcd3a.sql
-- --------------------------------------------------------------
-- Create trains table for verified train data
CREATE TABLE public.trains (
  train_number TEXT PRIMARY KEY,
  train_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.trains ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read trains
CREATE POLICY "Anyone can view trains"
ON public.trains
FOR SELECT
USING (true);

-- Create unverified_trains table for user-entered trains not in database
CREATE TABLE public.unverified_trains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  train_number TEXT NOT NULL,
  train_name TEXT,
  submitted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.unverified_trains ENABLE ROW LEVEL SECURITY;

-- Users can insert unverified trains
CREATE POLICY "Users can submit unverified trains"
ON public.unverified_trains
FOR INSERT
WITH CHECK (auth.uid() = submitted_by);

-- Users can view their own submissions
CREATE POLICY "Users can view own unverified submissions"
ON public.unverified_trains
FOR SELECT
USING (auth.uid() = submitted_by);

-- Add train_name column to journeys table for display purposes
ALTER TABLE public.journeys ADD COLUMN IF NOT EXISTS train_name TEXT;

-- Insert sample Indian train data (popular trains)
INSERT INTO public.trains (train_number, train_name) VALUES
-- Rajdhani Express trains
('12301', 'Howrah Rajdhani Express'),
('12302', 'New Delhi Rajdhani Express'),
('12309', 'Rajdhani Express'),
('12310', 'Rajdhani Express'),
('12313', 'Sealdah Rajdhani Express'),
('12314', 'New Delhi Rajdhani Express'),
('12951', 'Mumbai Rajdhani Express'),
('12952', 'New Delhi Rajdhani Express'),
('12953', 'August Kranti Rajdhani Express'),
('12954', 'August Kranti Rajdhani Express'),
-- Shatabdi Express trains
('12001', 'Bhopal Shatabdi Express'),
('12002', 'New Delhi Shatabdi Express'),
('12003', 'Lucknow Swarn Shatabdi Express'),
('12004', 'New Delhi Swarn Shatabdi Express'),
('12005', 'Kalka Shatabdi Express'),
('12006', 'New Delhi Shatabdi Express'),
('12007', 'Chennai Shatabdi Express'),
('12008', 'Mysuru Shatabdi Express'),
('12009', 'Mumbai Shatabdi Express'),
('12010', 'Ahmedabad Shatabdi Express'),
('12011', 'Kalka Shatabdi Express'),
('12012', 'New Delhi Shatabdi Express'),
('12013', 'Amritsar Shatabdi Express'),
('12014', 'New Delhi Shatabdi Express'),
('12015', 'Ajmer Shatabdi Express'),
('12016', 'New Delhi Shatabdi Express'),
('12017', 'Dehradun Shatabdi Express'),
('12018', 'New Delhi Shatabdi Express'),
('12019', 'Howrah Shatabdi Express'),
('12020', 'Ranchi Shatabdi Express'),
-- Duronto Express trains
('12213', 'Delhi Sarai Rohilla Duronto Express'),
('12214', 'Delhi Sarai Rohilla Duronto Express'),
('12259', 'Sealdah Duronto Express'),
('12260', 'New Delhi Duronto Express'),
('12261', 'Mumbai CST Duronto Express'),
('12262', 'Howrah Duronto Express'),
('12263', 'Hazrat Nizamuddin Duronto Express'),
('12264', 'Pune Duronto Express'),
('12265', 'Mumbai Bandra Duronto Express'),
('12266', 'Hazrat Nizamuddin Duronto Express'),
-- Garib Rath Express trains
('12201', 'Mumbai Garib Rath Express'),
('12202', 'Kochuveli Garib Rath Express'),
('12203', 'Saharsa Garib Rath Express'),
('12204', 'Amritsar Garib Rath Express'),
-- Popular Mail/Express trains
('12627', 'Karnataka Express'),
('12628', 'Karnataka Express'),
('12621', 'Tamil Nadu Express'),
('12622', 'Tamil Nadu Express'),
('12623', 'Thiruvananthapuram Mail'),
('12624', 'Chennai Mail'),
('12625', 'Kerala Express'),
('12626', 'Kerala Express'),
('12629', 'Karnataka Sampark Kranti Express'),
('12630', 'Karnataka Sampark Kranti Express'),
('12631', 'Nellai Express'),
('12632', 'Nellai Express'),
('12633', 'Kanyakumari Express'),
('12634', 'Kanyakumari Express'),
('12635', 'Vaigai Express'),
('12636', 'Vaigai Express'),
('12637', 'Pandian Express'),
('12638', 'Pandian Express'),
('12639', 'Brindavan Express'),
('12640', 'Brindavan Express'),
-- Jan Shatabdi Express trains
('12051', 'Jan Shatabdi Express'),
('12052', 'Jan Shatabdi Express'),
('12053', 'Jan Shatabdi Express'),
('12054', 'Jan Shatabdi Express'),
('12055', 'Jan Shatabdi Express'),
('12056', 'Jan Shatabdi Express'),
('12057', 'Jan Shatabdi Express'),
('12058', 'Jan Shatabdi Express'),
-- Superfast Express trains
('12101', 'Jnaneshwari Super Deluxe Express'),
('12102', 'Jnaneshwari Super Deluxe Express'),
('12105', 'Vidarbha Express'),
('12106', 'Vidarbha Express'),
('12107', 'Lucknow Superfast Express'),
('12108', 'Lucknow Superfast Express'),
('12109', 'Panchavati Express'),
('12110', 'Panchavati Express'),
('12111', 'Amritsar Superfast Express'),
('12112', 'Amritsar Superfast Express'),
('12113', 'Nagpur Superfast Express'),
('12114', 'Nagpur Superfast Express'),
('12115', 'Siddheshwar Express'),
('12116', 'Siddheshwar Express'),
('12117', 'Latur Express'),
('12118', 'Latur Express'),
('12119', 'Ajmer Superfast Express'),
('12120', 'Ajmer Superfast Express'),
('12121', 'Deccan Queen'),
('12122', 'Deccan Queen'),
('12123', 'Deccan Queen Express'),
('12124', 'Deccan Queen Express'),
('12125', 'Pragati Express'),
('12126', 'Pragati Express'),
('12127', 'Mumbai Pune Intercity Express'),
('12128', 'Mumbai Pune Intercity Express'),
('12129', 'Pune Azad Hind Express'),
('12130', 'Pune Azad Hind Express'),
('12131', 'Pune Express'),
('12132', 'Pune Express'),
('12133', 'Mumbai CSMT Mangaluru Junction SF Express'),
('12134', 'Mangaluru Junction Mumbai CSMT SF Express'),
('12135', 'Pune Nagpur Superfast Express'),
('12136', 'Nagpur Pune Superfast Express'),
('12137', 'Punjab Mail'),
('12138', 'Punjab Mail'),
('12139', 'Sewagram Express'),
('12140', 'Sewagram Express'),
-- Vande Bharat Express trains
('22435', 'Vande Bharat Express'),
('22436', 'Vande Bharat Express'),
('22437', 'Vande Bharat Express'),
('22438', 'Vande Bharat Express'),
('22439', 'Vande Bharat Express'),
('22440', 'Vande Bharat Express'),
('20601', 'Vande Bharat Express'),
('20602', 'Vande Bharat Express'),
('20603', 'Vande Bharat Express'),
('20604', 'Vande Bharat Express'),
('20605', 'Vande Bharat Express'),
('20606', 'Vande Bharat Express'),
('20607', 'Vande Bharat Express'),
('20608', 'Vande Bharat Express'),
('20609', 'Vande Bharat Express'),
('20610', 'Vande Bharat Express'),
-- Tejas Express trains
('22119', 'Tejas Express'),
('22120', 'Tejas Express'),
('22121', 'Tejas Express'),
('22122', 'Tejas Express'),
('82501', 'Tejas Express'),
('82502', 'Tejas Express'),
('82901', 'Tejas Express'),
('82902', 'Tejas Express'),
-- Gatimaan Express
('12049', 'Gatimaan Express'),
('12050', 'Gatimaan Express'),
-- Humsafar Express trains
('12595', 'Humsafar Express'),
('12596', 'Humsafar Express'),
('22483', 'Humsafar Express'),
('22484', 'Humsafar Express'),
('22485', 'Humsafar Express'),
('22486', 'Humsafar Express'),
-- Antyodaya Express trains
('22921', 'Antyodaya Express'),
('22922', 'Antyodaya Express'),
('22923', 'Antyodaya Express'),
('22924', 'Antyodaya Express'),
-- Mumbai local important trains (for testing)
('11007', 'Deccan Express'),
('11008', 'Deccan Express'),
('11009', 'Sinhagad Express'),
('11010', 'Sinhagad Express'),
('11011', 'Mumbai Kolhapur Mahalaxmi Express'),
('11012', 'Mumbai Kolhapur Mahalaxmi Express'),
('11013', 'Mumbai Coimbatore Express'),
('11014', 'Coimbatore Mumbai Express'),
('11015', 'Kushinagar Express'),
('11016', 'Kushinagar Express'),
('11017', 'Mumbai Karwar Express'),
('11018', 'Karwar Mumbai Express'),
('11019', 'Mumbai Bhubaneswar Konark Express'),
('11020', 'Bhubaneswar Mumbai Konark Express'),
('11021', 'Mumbai Tirunelveli Chalukya Express'),
('11022', 'Tirunelveli Mumbai Chalukya Express'),
-- Chennai bound trains
('12841', 'Coromandel Express'),
('12842', 'Coromandel Express'),
('12843', 'Puri Ahmedabad Express'),
('12844', 'Ahmedabad Puri Express'),
('12845', 'Pune Howrah Superfast Express'),
('12846', 'Howrah Pune Superfast Express'),
('12859', 'Mumbai Howrah Gitanjali Express'),
('12860', 'Howrah Mumbai Gitanjali Express'),
-- Northern region trains
('14005', 'Lichchhavi Express'),
('14006', 'Lichchhavi Express'),
('14007', 'Sadbhavana Express'),
('14008', 'Sadbhavana Express'),
('14009', 'Champaran Humsafar Express'),
('14010', 'Champaran Humsafar Express'),
('14011', 'Delhi Hoshiarpur Express'),
('14012', 'Hoshiarpur Delhi Express'),
('14015', 'Kashi Express'),
('14016', 'Kashi Express'),
('14017', 'Sadbhavana Express'),
('14018', 'Sadbhavana Express'),
('14019', 'Tripuri Express'),
('14020', 'Tripuri Express'),
-- Southern region trains  
('16525', 'Island Express'),
('16526', 'Island Express'),
('16527', 'Yesvantpur Express'),
('16528', 'Yesvantpur Express'),
('16529', 'Yesvantpur Karwar Express'),
('16530', 'Karwar Yesvantpur Express'),
('16531', 'Ajmer Express'),
('16532', 'Ajmer Express'),
('16533', 'Bangalore Express'),
('16534', 'Bangalore Express'),
('16535', 'Golgumbaz Express'),
('16536', 'Golgumbaz Express'),
-- Western region trains
('19019', 'Delhi Dehradun Express'),
('19020', 'Dehradun Delhi Express'),
('19021', 'Mumbai Bandra Lucknow Express'),
('19022', 'Lucknow Mumbai Bandra Express'),
('19023', 'Mumbai Bandra Firozpur Janata Express'),
('19024', 'Firozpur Mumbai Bandra Janata Express'),
('19025', 'Mumbai Bandra Amritsar Express'),
('19026', 'Amritsar Mumbai Bandra Express'),
('19027', 'Mumbai Bandra Jammu Tawi Express'),
('19028', 'Jammu Tawi Mumbai Bandra Express'),
-- Eastern region trains
('12381', 'Poorva Express'),
('12382', 'Poorva Express'),
('12383', 'Asansol Sealdah Express'),
('12384', 'Sealdah Asansol Express'),
('12385', 'Howrah Dhanbad Black Diamond Express'),
('12386', 'Dhanbad Howrah Black Diamond Express'),
('12387', 'Howrah Patna Suryanagari Express'),
('12388', 'Patna Howrah Suryanagari Express'),
-- Additional popular trains
('12403', 'Allahabad Mumbai Express'),
('12404', 'Mumbai Allahabad Express'),
('12405', 'Gondwana Express'),
('12406', 'Gondwana Express'),
('12407', 'Karmabhoomi Express'),
('12408', 'Karmabhoomi Express'),
('12409', 'Gondwana Express'),
('12410', 'Gondwana Express'),
('12411', 'Chandigarh Amritsar Express'),
('12412', 'Amritsar Chandigarh Express'),
('12413', 'Jammu Tawi Ajmer Express'),
('12414', 'Ajmer Jammu Tawi Express'),
('12415', 'Delhi Indore Express'),
('12416', 'Indore Delhi Express'),
('12417', 'Prayagraj Express'),
('12418', 'Prayagraj Express'),
('12419', 'Gomti Express'),
('12420', 'Gomti Express'),
('12423', 'Dibrugarh Rajdhani Express'),
('12424', 'Dibrugarh Rajdhani Express'),
('12425', 'Jammu Tawi Rajdhani Express'),
('12426', 'Jammu Tawi Rajdhani Express'),
('12427', 'Thiruvananthapuram Rajdhani Express'),
('12428', 'Thiruvananthapuram Rajdhani Express'),
('12429', 'Bangalore Rajdhani Express'),
('12430', 'Bangalore Rajdhani Express'),
('12431', 'Thiruvananthapuram Rajdhani Express'),
('12432', 'Thiruvananthapuram Rajdhani Express'),
('12433', 'Chennai Rajdhani Express'),
('12434', 'Chennai Rajdhani Express'),
('12435', 'Dibrugarh Rajdhani Express'),
('12436', 'Dibrugarh Rajdhani Express'),
('12437', 'Secunderabad Rajdhani Express'),
('12438', 'Secunderabad Rajdhani Express'),
('12439', 'Ranchi Rajdhani Express'),
('12440', 'Ranchi Rajdhani Express'),
('12441', 'Bilaspur Rajdhani Express'),
('12442', 'Bilaspur Rajdhani Express'),
('12443', 'Bhopal Rajdhani Express'),
('12444', 'Bhopal Rajdhani Express')
ON CONFLICT (train_number) DO NOTHING;

-- --------------------------------------------------------------
-- 20251223123652_e2b06a2d-b44e-4fad-91b2-adf61fe43509.sql
-- --------------------------------------------------------------
-- Add entered_value and normalized_value columns to unverified_trains
ALTER TABLE public.unverified_trains 
ADD COLUMN IF NOT EXISTS entered_value text,
ADD COLUMN IF NOT EXISTS normalized_value text;

-- --------------------------------------------------------------
-- 20251226092210_ac8f402f-5c62-4004-99fa-8fe0ee80e438.sql
-- --------------------------------------------------------------
-- Allow users to delete their own outgoing pending requests (cancel)
CREATE POLICY "Users can delete their pending outgoing requests"
ON public.requests
FOR DELETE
USING (auth.uid() = from_user_id AND status = 'pending');

-- --------------------------------------------------------------
-- 20251226092940_0942da88-35dd-4e18-a7a8-904c8cef7d8a.sql
-- --------------------------------------------------------------
-- Drop the existing update policy
DROP POLICY IF EXISTS "Users can update conversations they participate in" ON public.conversations;

-- Create a new update policy that allows participants to update the conversation
-- The WITH CHECK ensures the update is valid (user remains a participant)
CREATE POLICY "Users can update conversations they participate in"
ON public.conversations
FOR UPDATE
USING (auth.uid() = ANY(participants))
WITH CHECK (auth.uid() = ANY(participants));

-- --------------------------------------------------------------
-- 20251227090748_bdb97748-6852-458d-bfba-d05bfad6e197.sql
-- --------------------------------------------------------------
-- Drop the existing update policy completely
DROP POLICY IF EXISTS "Users can update conversations they participate in" ON public.conversations;

-- Create updated policy with proper USING and WITH CHECK clauses
-- This allows participants to update the conversation (including adding themselves to deleted_for)
CREATE POLICY "Users can update conversations they participate in"
ON public.conversations
FOR UPDATE
USING (auth.uid() = ANY(participants))
WITH CHECK (auth.uid() = ANY(participants));

-- --------------------------------------------------------------
-- 20251227092113_069edbb0-2035-429e-8c82-2fbe4a6c7847.sql
-- --------------------------------------------------------------
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

-- --------------------------------------------------------------
-- 20251227101646_40a0784f-18db-4c0f-b9c2-c010e51bd5c9.sql
-- --------------------------------------------------------------
-- Add new profile fields
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS bio text,
ADD COLUMN IF NOT EXISTS hobbies text,
ADD COLUMN IF NOT EXISTS avatar_url text;

-- Create storage bucket for profile avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload their own avatar
CREATE POLICY "Users can upload their own avatar"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to update their own avatar
CREATE POLICY "Users can update their own avatar"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to delete their own avatar
CREATE POLICY "Users can delete their own avatar"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow public read access to avatars
CREATE POLICY "Avatars are publicly accessible"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- --------------------------------------------------------------
-- 20260106151017_8892ae92-6627-494b-bd56-58c43ec381dd.sql
-- --------------------------------------------------------------
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

-- --------------------------------------------------------------
-- 20260106164620_96b6e5c5-705e-4d56-819a-7611512a8c77.sql
-- --------------------------------------------------------------
-- Make avatars bucket public again (profile photos need to be viewable by other users)
UPDATE storage.buckets SET public = true WHERE id = 'avatars';

-- Update storage policies to allow public read but authenticated upload
DROP POLICY IF EXISTS "Users can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;

-- Public read access for avatars
CREATE POLICY "Avatars are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Authenticated users can manage their own avatars
CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- --------------------------------------------------------------
-- 20260119144831_86245a52-19c5-42c5-98fd-51cd97df26ef.sql
-- --------------------------------------------------------------
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

-- --------------------------------------------------------------
-- 20260418102918_e29f8b04-aa57-42dd-a11a-0a178e78042a.sql
-- --------------------------------------------------------------

-- Make avatars bucket private to prevent unauthenticated enumeration and listing
UPDATE storage.buckets SET public = false WHERE id = 'avatars';

-- Drop the broad public SELECT policy
DROP POLICY IF EXISTS "Avatars are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view avatars" ON storage.objects;

-- Allow only authenticated users to read avatar files (no anonymous access, no public listing)
CREATE POLICY "Authenticated users can view avatars"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'avatars');


-- --------------------------------------------------------------
-- 20260418104404_779f9022-e784-4b5a-b8a0-ff69b5adc5c8.sql
-- --------------------------------------------------------------

-- 1. Drop user_email column from journeys (email leak via can_view_journey policy)
ALTER TABLE public.journeys DROP COLUMN IF EXISTS user_email;

-- 2. Add Realtime channel authorization
-- Enable RLS on realtime.messages (the broadcast/presence/postgres_changes payload table)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to receive realtime events only for conversations they participate in.
-- Topic format used by client subscriptions: "messages-<conversation_id>" and "conversations-updates"
DROP POLICY IF EXISTS "Authenticated users can receive their conversation messages" ON realtime.messages;
CREATE POLICY "Authenticated users can receive their conversation messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Per-conversation channel: messages-<uuid>
  (
    realtime.topic() LIKE 'messages-%'
    AND public.is_conversation_participant(
      NULLIF(replace(realtime.topic(), 'messages-', ''), '')::uuid
    )
  )
  OR
  -- Global conversations updates channel — only authenticated users (further filtered by table RLS)
  realtime.topic() = 'conversations-updates'
);


-- --------------------------------------------------------------
-- 20260618111613_86bde92e-8a9f-436e-a92b-95ff0b252e4e.sql
-- --------------------------------------------------------------

ALTER TABLE public.messages 
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_type text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_size bigint;

CREATE POLICY "Participants can read chat attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.is_conversation_participant((split_part(name, '/', 1))::uuid)
);

CREATE POLICY "Participants can upload chat attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND public.is_conversation_participant((split_part(name, '/', 1))::uuid)
  AND owner = auth.uid()
);

CREATE POLICY "Owners can delete their chat attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'chat-attachments' AND owner = auth.uid()
);


-- --------------------------------------------------------------
-- 20260618111636_b0dcdda5-faca-47fd-9f7b-9db7a4bd4c8c.sql
-- --------------------------------------------------------------

ALTER TABLE public.last_read REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'last_read'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.last_read';
  END IF;
END $$;


-- --------------------------------------------------------------
-- 20260630113712_da08abd9-3285-4c47-8f17-6eb6681bf7f0.sql
-- --------------------------------------------------------------

-- 1) Prevent tampering of immutable conversation fields
CREATE OR REPLACE FUNCTION public.prevent_conversation_tamper()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.participants IS DISTINCT FROM OLD.participants
     OR NEW.participant_names IS DISTINCT FROM OLD.participant_names
     OR NEW.train_number IS DISTINCT FROM OLD.train_number
     OR NEW.travel_date IS DISTINCT FROM OLD.travel_date
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Modifying protected conversation fields is not allowed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_prevent_tamper ON public.conversations;
CREATE TRIGGER conversations_prevent_tamper
BEFORE UPDATE ON public.conversations
FOR EACH ROW EXECUTE FUNCTION public.prevent_conversation_tamper();

-- 2) Helper: check if the caller is blocked by/blocking any other participant in conversation
CREATE OR REPLACE FUNCTION public.is_blocked_in_conversation(conv_id uuid, uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c, unnest(c.participants) AS p
    WHERE c.id = conv_id
      AND p <> uid
      AND public.is_blocked(uid, p)
  )
$$;

-- 3) Helper: validate that conversation creation is allowed (accepted request + no block, 2 participants)
CREATE OR REPLACE FUNCTION public.can_create_conversation(parts uuid[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    parts IS NOT NULL
    AND array_length(parts, 1) = 2
    AND auth.uid() = ANY(parts)
    AND NOT public.is_blocked(parts[1], parts[2])
    AND EXISTS (
      SELECT 1 FROM public.requests r
      WHERE r.status = 'accepted'
        AND (
          (r.from_user_id = parts[1] AND r.to_user_id = parts[2])
          OR (r.from_user_id = parts[2] AND r.to_user_id = parts[1])
        )
    )
$$;

-- 4) Tighten conversations INSERT policy: require accepted companion + no block
DROP POLICY IF EXISTS "Users can create conversations they participate in" ON public.conversations;
CREATE POLICY "Users can create accepted-companion conversations"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (public.can_create_conversation(participants));

-- 5) Block enforcement on messages INSERT
DROP POLICY IF EXISTS "Users can send messages in their conversations" ON public.messages;
CREATE POLICY "Users can send messages in their conversations"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = sender_id
  AND public.is_conversation_participant(conversation_id)
  AND NOT public.is_blocked_in_conversation(conversation_id, auth.uid())
);

-- 6) Realtime: scope the conversations-updates broadcast topic per user
DROP POLICY IF EXISTS "Authenticated users can receive their conversation messages" ON realtime.messages;
CREATE POLICY "Authenticated users can receive their conversation messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (
    realtime.topic() LIKE 'messages-%'
    AND public.is_conversation_participant(
      (NULLIF(replace(realtime.topic(), 'messages-', ''), ''))::uuid
    )
  )
  OR (
    realtime.topic() LIKE 'last-read-%'
  )
  OR (
    realtime.topic() = ('conversations-updates-' || auth.uid()::text)
  )
);

-- 7) Storage: add missing UPDATE policy for chat-attachments
CREATE POLICY "Owners can update their chat attachments"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
  AND public.is_conversation_participant((split_part(name, '/', 1))::uuid)
)
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND owner = auth.uid()
  AND public.is_conversation_participant((split_part(name, '/', 1))::uuid)
);

-- 8) Lock down SECURITY DEFINER helpers from anon execution
REVOKE EXECUTE ON FUNCTION public.is_conversation_participant(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_view_journey(text, date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_view_profile(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.soft_delete_conversation(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_blocked_in_conversation(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.can_create_conversation(uuid[]) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_journey(text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_blocked_in_conversation(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_create_conversation(uuid[]) TO authenticated;


-- --------------------------------------------------------------
-- 20260630153027_2abc8ebe-db91-477e-afaa-6f7afacbf96a.sql
-- --------------------------------------------------------------

-- Defense-in-depth: restrict UPDATE privilege to only the safe columns.
-- The conversations_prevent_tamper trigger remains as a second guard.

REVOKE UPDATE ON public.conversations FROM authenticated;
REVOKE UPDATE ON public.conversations FROM anon;

GRANT UPDATE (last_message, last_message_time, deleted_for)
  ON public.conversations TO authenticated;

-- service_role keeps full access (used by edge functions / admin paths)
GRANT ALL ON public.conversations TO service_role;


-- --------------------------------------------------------------
-- 20260702121413_f44b81c6-1de3-40d3-8b75-62b00342fbc4.sql
-- --------------------------------------------------------------

-- Cleanup exploit seed
DELETE FROM public.conversations WHERE id = '11111111-1111-1111-1111-111111111111';

-- Replace realtime SELECT policy on realtime.messages
DROP POLICY IF EXISTS "Authenticated users can receive their conversation messages" ON realtime.messages;

CREATE POLICY "Authenticated users can receive their conversation messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- messages-<conversationId>
  (
    realtime.topic() LIKE 'messages-%'
    AND public.is_conversation_participant(
      NULLIF(replace(realtime.topic(), 'messages-', ''), '')::uuid
    )
  )
  OR
  -- last-read-<conversationId>-<otherUserId> — only participants of that conversation
  (
    realtime.topic() LIKE 'last-read-%'
    AND public.is_conversation_participant(
      substring(realtime.topic() from 11 for 36)::uuid
    )
  )
  OR
  -- per-user conversations updates channel
  (
    realtime.topic() = ('conversations-updates-' || auth.uid()::text)
  )
);


-- --------------------------------------------------------------
-- 20260703100726_1ec62bfb-f05f-4ce9-87b2-e477000de677.sql
-- --------------------------------------------------------------

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


-- --------------------------------------------------------------
-- 20260716172422_8500280b-12b4-4354-a4a0-f9e015579085.sql
-- --------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view avatars" ON storage.objects;

CREATE POLICY "Users can view contextual avatars"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.can_view_profile(((storage.foldername(name))[1])::uuid)
  )
);

-- --------------------------------------------------------------
-- 20260716175301_6c4b51cb-7bdd-4688-9bf3-59a218f7670d.sql
-- --------------------------------------------------------------

REVOKE SELECT ON public.profiles, public.profiles_safe, public.conversations, public.messages, public.journeys, public.requests, public.blocked_users, public.last_read, public.user_reports, public.unverified_trains FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.blocked_users, public.unverified_trains, public.user_reports, public.conversations, public.requests, public.profiles FROM anon;


-- --------------------------------------------------------------
-- 20260717044642_c521be6a-94aa-4738-bbd5-c29f7db328c6.sql
-- --------------------------------------------------------------

COMMENT ON TABLE public.profiles IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.conversations IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.messages IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.journeys IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.requests IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.blocked_users IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.last_read IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.user_reports IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.unverified_trains IS e'@graphql({"visible": false})';
COMMENT ON VIEW public.profiles_safe IS e'@graphql({"visible": false})';

COMMENT ON FUNCTION public.can_create_conversation(uuid[], text, date) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.can_view_journey(text, date) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.can_view_profile(uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.is_blocked(uuid, uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.is_blocked_in_conversation(uuid, uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.is_conversation_participant(uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.users_share_journey(uuid, uuid, text, date) IS e'@graphql({"visible": false})';


-- --------------------------------------------------------------
-- 20260717044738_a522a1fb-8055-4c37-9935-f6128f373267.sql
-- --------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION graphql_public.graphql(text, text, jsonb, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE USAGE ON SCHEMA graphql_public FROM anon, authenticated;


-- --------------------------------------------------------------
-- 20260717044824_a364f2b9-9669-4b69-aff5-c2bc6e8c17c8.sql
-- --------------------------------------------------------------

-- Force pg_graphql to rebuild by issuing DDL after comments
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.last_read ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unverified_trains ENABLE ROW LEVEL SECURITY;

-- Re-apply visibility comments explicitly
COMMENT ON TABLE public.profiles IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.conversations IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.messages IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.journeys IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.requests IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.blocked_users IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.last_read IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.user_reports IS e'@graphql({"visible": false})';
COMMENT ON TABLE public.unverified_trains IS e'@graphql({"visible": false})';
COMMENT ON VIEW public.profiles_safe IS e'@graphql({"visible": false})';

COMMENT ON FUNCTION public.can_create_conversation(uuid[], text, date) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.can_view_journey(text, date) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.can_view_profile(uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.is_blocked(uuid, uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.is_blocked_in_conversation(uuid, uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.is_conversation_participant(uuid) IS e'@graphql({"visible": false})';
COMMENT ON FUNCTION public.users_share_journey(uuid, uuid, text, date) IS e'@graphql({"visible": false})';


-- --------------------------------------------------------------
-- 20260717045003_2f6b2246-3cee-4ca5-80f0-180fd2d164f9.sql
-- --------------------------------------------------------------

DROP EXTENSION IF EXISTS pg_graphql CASCADE;


-- --------------------------------------------------------------
-- 20260722181045_820a8bb7-4d3b-48ad-8e89-b92110f9787d.sql
-- --------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
