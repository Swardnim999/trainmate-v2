-- Allow users to delete their own outgoing pending requests (cancel)
CREATE POLICY "Users can delete their pending outgoing requests"
ON public.requests
FOR DELETE
USING (auth.uid() = from_user_id AND status = 'pending');