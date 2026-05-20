-- Resolve Supabase warning:
-- "View public.queue_release_controls_view is defined with the SECURITY DEFINER property"
-- Force the view to run with caller privileges (RLS/permissions from querying user).

alter view if exists public.queue_release_controls_view
set (security_invoker = true);

