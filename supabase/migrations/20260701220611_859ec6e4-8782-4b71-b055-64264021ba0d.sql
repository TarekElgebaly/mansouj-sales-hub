DROP POLICY IF EXISTS "activity insert" ON public.order_activity;
CREATE POLICY "activity insert" ON public.order_activity
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write(auth.uid()));