-- Keep order cost editing available to the roles that manage operational/finance costs.
-- The app also uses a server route for these writes, but these RLS policies keep
-- direct authenticated updates consistent with the UI permission model.

CREATE OR REPLACE FUNCTION public.can_write(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$
  SELECT
    public.has_role(_uid, 'admin')
    OR public.has_role(_uid, 'operations')
    OR public.has_role(_uid, 'finance')
    OR public.has_role(_uid, 'shipping')
$$;

GRANT UPDATE (shipping_cost, packaging_cost) ON public.orders TO authenticated;

DROP POLICY IF EXISTS "orders update" ON public.orders;
CREATE POLICY "orders update" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.can_write(auth.uid()))
  WITH CHECK (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "activity insert" ON public.order_activity;
DROP POLICY IF EXISTS "activity insert write roles" ON public.order_activity;
CREATE POLICY "activity insert" ON public.order_activity
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write(auth.uid()));

NOTIFY pgrst, 'reload schema';
