-- =============================================
-- FIX: Users table RLS policy for new registrations
-- Run this in Supabase SQL Editor
-- =============================================

-- Drop existing insert policy if exists
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;

-- Create new policy to allow authenticated users to insert their own profile
CREATE POLICY "Users can insert own profile" ON public.users
    FOR INSERT 
    WITH CHECK (auth.uid()::text = id::text);

-- Also allow service role to insert (for migrations/admin)
DROP POLICY IF EXISTS "Service role can manage users" ON public.users;
CREATE POLICY "Service role can manage users" ON public.users
    FOR ALL 
    USING (auth.role() = 'service_role');

-- Verify policies
SELECT * FROM pg_policies WHERE tablename = 'users';
