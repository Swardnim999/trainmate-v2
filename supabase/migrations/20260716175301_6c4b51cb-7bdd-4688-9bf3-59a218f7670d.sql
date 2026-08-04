
REVOKE SELECT ON public.profiles, public.profiles_safe, public.conversations, public.messages, public.journeys, public.requests, public.blocked_users, public.last_read, public.user_reports, public.unverified_trains FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.blocked_users, public.unverified_trains, public.user_reports, public.conversations, public.requests, public.profiles FROM anon;
