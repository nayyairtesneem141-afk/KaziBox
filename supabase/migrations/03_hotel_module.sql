-- KaziBox Hotel Module Database Migration (03_hotel_module.sql)
-- Defines native KaziBox tables for Hotel & Property Management

-- 1. HOTEL ROOMS
CREATE TABLE IF NOT EXISTS public.hotel_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  room_number TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Standard',
  capacity INT NOT NULL DEFAULT 2,
  price_per_night NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  currency TEXT NOT NULL DEFAULT 'XOF',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning', 'maintenance')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_company_room_number UNIQUE (company_id, room_number)
);

-- 2. HOTEL GUESTS
CREATE TABLE IF NOT EXISTS public.hotel_guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  id_number TEXT,
  nationality TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. HOTEL RESERVATIONS
CREATE TABLE IF NOT EXISTS public.hotel_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.hotel_rooms(id) ON DELETE CASCADE,
  guest_id UUID NOT NULL REFERENCES public.hotel_guests(id) ON DELETE CASCADE,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'checked_in', 'checked_out', 'cancelled')),
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  currency TEXT NOT NULL DEFAULT 'XOF',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for optimal multi-tenant query performance
CREATE INDEX IF NOT EXISTS idx_hotel_rooms_company_id ON public.hotel_rooms(company_id);
CREATE INDEX IF NOT EXISTS idx_hotel_guests_company_id ON public.hotel_guests(company_id);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_company_id ON public.hotel_reservations(company_id);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_room_id ON public.hotel_reservations(room_id);
CREATE INDEX IF NOT EXISTS idx_hotel_reservations_guest_id ON public.hotel_reservations(guest_id);

-- Enable Row Level Security (RLS)
ALTER TABLE public.hotel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hotel_reservations ENABLE ROW LEVEL SECURITY;

-- 4. RLS POLICIES FOR HOTEL ROOMS
CREATE POLICY "Hotel rooms viewable within company"
  ON public.hotel_rooms FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Hotel rooms manageable by company staff"
  ON public.hotel_rooms FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 5. RLS POLICIES FOR HOTEL GUESTS
CREATE POLICY "Hotel guests viewable within company"
  ON public.hotel_guests FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Hotel guests manageable by company staff"
  ON public.hotel_guests FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );

-- 6. RLS POLICIES FOR HOTEL RESERVATIONS
CREATE POLICY "Hotel reservations viewable within company"
  ON public.hotel_reservations FOR SELECT
  TO authenticated
  USING (company_id = get_auth_user_company_id() OR is_platform_admin());

CREATE POLICY "Hotel reservations manageable by company staff"
  ON public.hotel_reservations FOR ALL
  TO authenticated
  USING (
    (company_id = get_auth_user_company_id() AND get_auth_user_role() IN ('owner', 'manager', 'worker', 'platform_admin'))
    OR is_platform_admin()
  );
