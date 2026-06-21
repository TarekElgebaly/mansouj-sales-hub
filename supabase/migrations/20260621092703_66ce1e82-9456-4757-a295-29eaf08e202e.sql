
-- =========================================================
-- ROLES & PROFILES
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'operations', 'finance', 'shipping', 'viewer');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by signed-in" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- helpers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- auto profile + default viewer role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'viewer') ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- write-permission helpers
CREATE OR REPLACE FUNCTION public.can_ops(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'operations') $$;

CREATE OR REPLACE FUNCTION public.can_finance(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'finance') $$;

CREATE OR REPLACE FUNCTION public.can_shipping(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'shipping') OR public.has_role(_uid,'operations') $$;

CREATE OR REPLACE FUNCTION public.can_write(_uid UUID) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS
$$ SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'operations') OR public.has_role(_uid,'finance') OR public.has_role(_uid,'shipping') $$;

-- =========================================================
-- AREAS
-- =========================================================
CREATE TABLE public.areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL,
  area TEXT NOT NULL,
  shipping_company TEXT,
  shipping_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_notes TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.areas TO authenticated;
GRANT ALL ON public.areas TO service_role;
ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "areas read" ON public.areas FOR SELECT TO authenticated USING (true);
CREATE POLICY "areas write ops" ON public.areas FOR ALL TO authenticated
  USING (public.can_ops(auth.uid())) WITH CHECK (public.can_ops(auth.uid()));
CREATE TRIGGER areas_updated_at BEFORE UPDATE ON public.areas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- CUSTOMERS
-- =========================================================
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  second_phone TEXT,
  city TEXT,
  area TEXT,
  full_address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_idx ON public.customers(phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers read" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers write ops" ON public.customers FOR ALL TO authenticated
  USING (public.can_ops(auth.uid())) WITH CHECK (public.can_ops(auth.uid()));
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- INVENTORY
-- =========================================================
CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  color TEXT,
  size TEXT,
  barcode TEXT,
  current_inventory INTEGER NOT NULL DEFAULT 0,
  cost_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'In Stock',
  product_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO authenticated;
GRANT ALL ON public.inventory TO service_role;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventory read" ON public.inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "inventory write ops" ON public.inventory FOR ALL TO authenticated
  USING (public.can_ops(auth.uid())) WITH CHECK (public.can_ops(auth.uid()));
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- ORDERS
-- =========================================================
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE,
  shopify_order_id TEXT UNIQUE,
  shopify_created_at TIMESTAMPTZ,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  second_phone TEXT,
  city TEXT,
  area TEXT,
  full_address TEXT,
  payment_gateway TEXT,
  confirmation_status TEXT NOT NULL DEFAULT 'Fresh Calls',
  order_status TEXT NOT NULL DEFAULT 'New',
  shipping_company TEXT,
  uploaded_to_shipping BOOLEAN NOT NULL DEFAULT false,
  delivered BOOLEAN NOT NULL DEFAULT false,
  rto BOOLEAN NOT NULL DEFAULT false,
  confirm_note TEXT,
  internal_notes TEXT,
  shipping_notes TEXT,
  total_selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  items_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  packaging_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  profit NUMERIC(12,2) GENERATED ALWAYS AS (total_selling_price - items_cost) STORED,
  net_profit NUMERIC(12,2) GENERATED ALWAYS AS (total_selling_price - items_cost - shipping_cost - packaging_cost) STORED,
  label_attachment TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_idx ON public.orders(order_status);
CREATE INDEX orders_confirmation_idx ON public.orders(confirmation_status);
CREATE INDEX orders_date_idx ON public.orders(order_date DESC);
CREATE INDEX orders_phone_idx ON public.orders(phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "orders insert" ON public.orders FOR INSERT TO authenticated WITH CHECK (public.can_ops(auth.uid()));
CREATE POLICY "orders update" ON public.orders FOR UPDATE TO authenticated
  USING (public.can_write(auth.uid())) WITH CHECK (public.can_write(auth.uid()));
CREATE POLICY "orders delete" ON public.orders FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- ORDER ITEMS
-- =========================================================
CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant TEXT,
  color TEXT,
  size TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_selling_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_selling_price NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_selling_price) STORED,
  total_cost NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_cost) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_items_order_idx ON public.order_items(order_id);
CREATE INDEX order_items_sku_idx ON public.order_items(sku);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "items read" ON public.order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "items write" ON public.order_items FOR ALL TO authenticated
  USING (public.can_ops(auth.uid())) WITH CHECK (public.can_ops(auth.uid()));

-- =========================================================
-- ORDER ACTIVITY + NOTES
-- =========================================================
CREATE TABLE public.order_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.order_activity TO authenticated;
GRANT ALL ON public.order_activity TO service_role;
ALTER TABLE public.order_activity ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity read" ON public.order_activity FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity insert" ON public.order_activity FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE TABLE public.order_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_notes TO authenticated;
GRANT ALL ON public.order_notes TO service_role;
ALTER TABLE public.order_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes read" ON public.order_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "notes insert" ON public.order_notes FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notes update own" ON public.order_notes FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notes delete own/admin" ON public.order_notes FOR DELETE TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- =========================================================
-- SETTINGS + MIGRATION LOGS
-- =========================================================
CREATE TABLE public.shopify_sync_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_url TEXT,
  webhook_endpoint TEXT,
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.shopify_sync_settings (id, store_url) VALUES (1, 'mansouj.myshopify.com') ON CONFLICT DO NOTHING;
GRANT SELECT ON public.shopify_sync_settings TO authenticated;
GRANT ALL ON public.shopify_sync_settings TO service_role;
ALTER TABLE public.shopify_sync_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync read" ON public.shopify_sync_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync admin write" ON public.shopify_sync_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.migration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  entity TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  rows_processed INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.migration_logs TO authenticated;
GRANT ALL ON public.migration_logs TO service_role;
ALTER TABLE public.migration_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "logs read" ON public.migration_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "logs insert" ON public.migration_logs FOR INSERT TO authenticated WITH CHECK (public.can_ops(auth.uid()));

-- =========================================================
-- SAMPLE DATA
-- =========================================================
INSERT INTO public.areas (city, area, shipping_company, shipping_cost, active) VALUES
  ('Cairo','Nasr City','Bosta',55,true),
  ('Cairo','Maadi','Bosta',55,true),
  ('Cairo','Heliopolis','Bosta',55,true),
  ('Giza','Dokki','Bosta',60,true),
  ('Giza','6th of October','Aramex',75,true),
  ('Alexandria','Sidi Gaber','Aramex',80,true),
  ('Alexandria','Smouha','Aramex',80,true),
  ('Qalyubia','Shubra El Kheima','Bosta',70,true),
  ('Ismailia','Downtown','Aramex',90,true),
  ('Beheira','Damanhur','Aramex',95,true);

INSERT INTO public.inventory (sku, product_name, variant_name, color, size, current_inventory, cost_price, sale_price, low_stock_threshold, status) VALUES
  ('TA9','Taji Coverlet','King','Beige','240x260',45,420,899,10,'In Stock'),
  ('TA7','Taji Coverlet','Queen','Grey','220x240',8,380,799,10,'Low Stock'),
  ('FSOWS','Jersy Fitted Sheet + Pillowcases','Set','White','180x200',60,180,399,15,'In Stock'),
  ('FSOS400','Percale Fitted Sheet + Pillowcases','400TC','Ivory','180x200',3,260,549,10,'Low Stock'),
  ('MPQ','Luxury Mattress Protector','Queen','White','160x200',0,140,299,10,'Out of Stock');

INSERT INTO public.customers (full_name, phone, city, area, full_address) VALUES
  ('Ahmed Hassan','01001234567','Cairo','Nasr City','12 El Tayaran St, Building 4, Apt 7'),
  ('Mona Saeed','01112345678','Giza','Dokki','5 Mossadak St, Apt 2'),
  ('Khaled Ibrahim','01223456789','Alexandria','Smouha','22 Victor Emanuel Sq, Apt 11');

WITH c1 AS (SELECT id FROM public.customers WHERE phone='01001234567'),
     c2 AS (SELECT id FROM public.customers WHERE phone='01112345678'),
     c3 AS (SELECT id FROM public.customers WHERE phone='01223456789')
INSERT INTO public.orders
  (order_number, order_date, customer_id, customer_full_name, phone, city, area, full_address,
   payment_gateway, confirmation_status, order_status, shipping_company,
   total_selling_price, items_cost, shipping_cost, packaging_cost, tags)
VALUES
  ('MJ-1001', CURRENT_DATE,         (SELECT id FROM c1),'Ahmed Hassan','01001234567','Cairo','Nasr City','12 El Tayaran St','COD','Confirmed','Ready','Bosta',  899, 420, 55, 10, ARRAY['shopify']),
  ('MJ-1002', CURRENT_DATE,         (SELECT id FROM c2),'Mona Saeed','01112345678','Giza','Dokki','5 Mossadak St','COD','Fresh Calls','New','Bosta',           549, 260, 60, 10, ARRAY['shopify']),
  ('MJ-1003', CURRENT_DATE - 1,     (SELECT id FROM c3),'Khaled Ibrahim','01223456789','Alexandria','Smouha','22 Victor Emanuel Sq','Paymob','Confirmed','Shipped','Aramex', 1198, 800, 80, 15, ARRAY['shopify']),
  ('MJ-1004', CURRENT_DATE - 3,     (SELECT id FROM c1),'Ahmed Hassan','01001234567','Cairo','Maadi','12 El Tayaran St','COD','Confirmed','Delivered','Bosta',  399, 180, 55, 10, ARRAY[]::TEXT[]),
  ('MJ-1005', CURRENT_DATE - 5,     (SELECT id FROM c2),'Mona Saeed','01112345678','Giza','6th of October','5 Mossadak St','COD','Cancel','Cancelled','Aramex', 299, 140, 75, 10, ARRAY['cancelled']);

UPDATE public.orders SET delivered=true WHERE order_number='MJ-1004';

INSERT INTO public.order_items (order_id, sku, product_name, variant, color, size, quantity, unit_selling_price, unit_cost)
SELECT o.id, 'TA9','Taji Coverlet','King','Beige','240x260',1,899,420 FROM public.orders o WHERE o.order_number='MJ-1001'
UNION ALL SELECT o.id,'FSOS400','Percale Fitted Sheet + Pillowcases','400TC','Ivory','180x200',1,549,260 FROM public.orders o WHERE o.order_number='MJ-1002'
UNION ALL SELECT o.id,'TA7','Taji Coverlet','Queen','Grey','220x240',1,799,380 FROM public.orders o WHERE o.order_number='MJ-1003'
UNION ALL SELECT o.id,'FSOWS','Jersy Fitted Sheet + Pillowcases','Set','White','180x200',1,399,180 FROM public.orders o WHERE o.order_number='MJ-1003'
UNION ALL SELECT o.id,'FSOWS','Jersy Fitted Sheet + Pillowcases','Set','White','180x200',1,399,180 FROM public.orders o WHERE o.order_number='MJ-1004'
UNION ALL SELECT o.id,'MPQ','Luxury Mattress Protector','Queen','White','160x200',1,299,140 FROM public.orders o WHERE o.order_number='MJ-1005';
