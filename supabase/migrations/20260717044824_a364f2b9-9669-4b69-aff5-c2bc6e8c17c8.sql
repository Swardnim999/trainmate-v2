
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
