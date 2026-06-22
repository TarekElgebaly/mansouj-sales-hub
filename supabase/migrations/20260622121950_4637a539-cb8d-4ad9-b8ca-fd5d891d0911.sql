
DROP POLICY "Authenticated read expenses" ON public.expenses;
CREATE POLICY "Finance read expenses" ON public.expenses FOR SELECT USING (public.can_finance(auth.uid()));

DROP POLICY "Authenticated read employees" ON public.employees;
CREATE POLICY "Finance read employees" ON public.employees FOR SELECT USING (public.can_finance(auth.uid()));

DROP POLICY "activity insert" ON public.order_activity;
CREATE POLICY "activity insert" ON public.order_activity FOR INSERT WITH CHECK (public.can_write(auth.uid()));
