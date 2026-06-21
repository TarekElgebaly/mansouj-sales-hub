
-- Profiles: restrict to self or admin
DROP POLICY IF EXISTS "profiles readable by signed-in" ON public.profiles;
CREATE POLICY "profiles read self or admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

-- Shopify sync settings: admin only
DROP POLICY IF EXISTS "sync read" ON public.shopify_sync_settings;
CREATE POLICY "sync read admin" ON public.shopify_sync_settings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Customers: restrict to roles that need PII (ops, finance, shipping, admin)
DROP POLICY IF EXISTS "customers read" ON public.customers;
CREATE POLICY "customers read" ON public.customers
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

-- Inventory: restrict (cost_price exposed) — limit to write roles
DROP POLICY IF EXISTS "inventory read" ON public.inventory;
CREATE POLICY "inventory read" ON public.inventory
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

-- Order items: restrict to write roles (matches orders)
DROP POLICY IF EXISTS "items read" ON public.order_items;
CREATE POLICY "items read" ON public.order_items
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));

-- Orders: restrict financial fields to write roles
DROP POLICY IF EXISTS "orders read" ON public.orders;
CREATE POLICY "orders read" ON public.orders
  FOR SELECT TO authenticated
  USING (public.can_write(auth.uid()));
