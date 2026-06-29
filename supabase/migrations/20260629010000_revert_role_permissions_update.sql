-- Revert the broad RBAC/permissions update from 20260628090000.
-- This restores the pre-update helper behavior and RLS policies while keeping
-- the existing roles/table structure intact.

CREATE OR REPLACE FUNCTION public.can_shipping(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'shipping') OR public.has_role(_uid,'operations') $$;

CREATE OR REPLACE FUNCTION public.can_write(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.can_ops(_uid) OR public.can_finance(_uid) OR public.can_shipping(_uid) $$;

DROP POLICY IF EXISTS "orders read" ON public.orders;
CREATE POLICY "orders read" ON public.orders
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "orders update" ON public.orders;
CREATE POLICY "orders update" ON public.orders
  FOR UPDATE TO authenticated
  USING (public.can_write(auth.uid()))
  WITH CHECK (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "items read" ON public.order_items;
CREATE POLICY "items read" ON public.order_items
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "items write" ON public.order_items;
CREATE POLICY "items write" ON public.order_items
  FOR ALL TO authenticated
  USING (public.can_write(auth.uid()))
  WITH CHECK (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "customers read" ON public.customers;
CREATE POLICY "customers read" ON public.customers
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "customers write ops" ON public.customers;
CREATE POLICY "customers write ops" ON public.customers
  FOR ALL TO authenticated
  USING (public.can_ops(auth.uid()))
  WITH CHECK (public.can_ops(auth.uid()));

DROP POLICY IF EXISTS "inventory read" ON public.inventory;
CREATE POLICY "inventory read" ON public.inventory
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "inventory write admin" ON public.inventory;
DROP POLICY IF EXISTS "inventory write ops" ON public.inventory;
CREATE POLICY "inventory write ops" ON public.inventory
  FOR ALL TO authenticated
  USING (public.can_ops(auth.uid()))
  WITH CHECK (public.can_ops(auth.uid()));

DROP POLICY IF EXISTS "activity read" ON public.order_activity;
CREATE POLICY "activity read" ON public.order_activity
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "activity insert" ON public.order_activity;
DROP POLICY IF EXISTS "activity insert write roles" ON public.order_activity;
CREATE POLICY "activity insert" ON public.order_activity
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write(auth.uid()));

DROP POLICY IF EXISTS "notes read" ON public.order_notes;
CREATE POLICY "notes read" ON public.order_notes
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

DROP FUNCTION IF EXISTS public.can_orders_read(UUID);
DROP FUNCTION IF EXISTS public.can_customers_read(UUID);
DROP FUNCTION IF EXISTS public.can_inventory_read(UUID);

NOTIFY pgrst, 'reload schema';
