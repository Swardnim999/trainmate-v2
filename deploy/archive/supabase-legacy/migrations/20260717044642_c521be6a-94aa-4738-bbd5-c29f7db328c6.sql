
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
