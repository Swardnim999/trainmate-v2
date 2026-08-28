
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
