
DROP POLICY IF EXISTS "notes read" ON public.order_notes;
CREATE POLICY "notes read" ON public.order_notes
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "activity read" ON public.order_activity;
CREATE POLICY "activity read" ON public.order_activity
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "logs read" ON public.migration_logs;
CREATE POLICY "logs read" ON public.migration_logs
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));
