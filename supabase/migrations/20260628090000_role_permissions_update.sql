-- Update existing role helpers and RLS policies to match the current team matrix.
-- Roles remain: admin, finance, operations, shipping, viewer.

CREATE OR REPLACE FUNCTION public.can_ops(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'operations') $$;

CREATE OR REPLACE FUNCTION public.can_finance(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'finance') $$;

CREATE OR REPLACE FUNCTION public.can_shipping(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'shipping') $$;

CREATE OR REPLACE FUNCTION public.can_write(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.can_ops(_uid) OR public.can_finance(_uid) $$;

CREATE OR REPLACE FUNCTION public.can_orders_read(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'admin')
      OR public.has_role(_uid,'operations')
      OR public.has_role(_uid,'finance')
      OR public.has_role(_uid,'shipping')
      OR public.has_role(_uid,'viewer')
$$;

CREATE OR REPLACE FUNCTION public.can_customers_read(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'admin')
      OR public.has_role(_uid,'operations')
      OR public.has_role(_uid,'viewer')
$$;

CREATE OR REPLACE FUNCTION public.can_inventory_read(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid,'admin')
      OR public.has_role(_uid,'shipping')
      OR public.has_role(_uid,'viewer')
$$;

DROP POLICY IF EXISTS "orders read" ON public.orders;
CREATE POLICY "orders read" ON public.orders
  FOR SELECT TO authenticated
  USING (public.can_orders_read(auth.uid()));

DROP POLICY IF EXISTS "orders update" ON public.orders;
CREATE POLICY "orders update" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.can_ops(auth.uid()) OR public.can_finance(auth.uid()))
  WITH CHECK (public.can_ops(auth.uid()) OR public.can_finance(auth.uid()));

DROP POLICY IF EXISTS "items read" ON public.order_items;
CREATE POLICY "items read" ON public.order_items
  FOR SELECT TO authenticated
  USING (public.can_orders_read(auth.uid()));

DROP POLICY IF EXISTS "items write" ON public.order_items;
CREATE POLICY "items write" ON public.order_items
  FOR ALL TO authenticated
  USING (public.can_ops(auth.uid()))
  WITH CHECK (public.can_ops(auth.uid()));

DROP POLICY IF EXISTS "customers read" ON public.customers;
CREATE POLICY "customers read" ON public.customers
  FOR SELECT TO authenticated
  USING (public.can_customers_read(auth.uid()));

DROP POLICY IF EXISTS "customers write ops" ON public.customers;
CREATE POLICY "customers write ops" ON public.customers
  FOR ALL TO authenticated
  USING (public.can_ops(auth.uid()))
  WITH CHECK (public.can_ops(auth.uid()));

DROP POLICY IF EXISTS "inventory read" ON public.inventory;
CREATE POLICY "inventory read" ON public.inventory
  FOR SELECT TO authenticated
  USING (public.can_inventory_read(auth.uid()));

DROP POLICY IF EXISTS "inventory write ops" ON public.inventory;
DROP POLICY IF EXISTS "inventory write admin" ON public.inventory;
CREATE POLICY "inventory write admin" ON public.inventory
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "activity read" ON public.order_activity;
CREATE POLICY "activity read" ON public.order_activity
  FOR SELECT TO authenticated
  USING (public.can_orders_read(auth.uid()));

DROP POLICY IF EXISTS "activity insert" ON public.order_activity;
DROP POLICY IF EXISTS "activity insert write roles" ON public.order_activity;
CREATE POLICY "activity insert write roles" ON public.order_activity
  FOR INSERT TO authenticated
  WITH CHECK (public.can_ops(auth.uid()) OR public.can_finance(auth.uid()));

DROP POLICY IF EXISTS "notes read" ON public.order_notes;
CREATE POLICY "notes read" ON public.order_notes
  FOR SELECT TO authenticated
  USING (public.can_orders_read(auth.uid()));
