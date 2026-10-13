-- ==============================================================================
-- KaziBox Supabase Migration (08_business_directory.sql)
-- Multi-Tenant African Business Directory Schema, Indexing & RLS Policies
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.business_directory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tagline JSONB NOT NULL DEFAULT '{"fr":"","en":""}'::jsonb,
  description JSONB NOT NULL DEFAULT '{"fr":"","en":""}'::jsonb,
  category TEXT NOT NULL CHECK (category IN (
    'hospitality', 'automotive', 'beauty', 'retail', 'health',
    'services', 'food', 'technology', 'logistics', 'other'
  )),
  country TEXT NOT NULL CHECK (char_length(country) = 2),
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  website TEXT,
  logo_url TEXT,
  cover_image_url TEXT,
  opening_hours TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review', 'approved', 'rejected', 'published', 'suspended', 'hidden'
  )),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  admin_notes TEXT,
  submitted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for high-performance discovery, search & filtering
CREATE INDEX IF NOT EXISTS idx_directory_status_active ON public.business_directory(status, is_active);
CREATE INDEX IF NOT EXISTS idx_directory_country_city ON public.business_directory(country, city);
CREATE INDEX IF NOT EXISTS idx_directory_category ON public.business_directory(category);
CREATE INDEX IF NOT EXISTS idx_directory_slug ON public.business_directory(slug);
CREATE INDEX IF NOT EXISTS idx_directory_company_id ON public.business_directory(company_id);
CREATE INDEX IF NOT EXISTS idx_directory_is_featured ON public.business_directory(is_featured);

-- Auto-update updated_at timestamp trigger
CREATE OR REPLACE FUNCTION public.update_directory_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_directory_timestamp ON public.business_directory;
CREATE TRIGGER trigger_update_directory_timestamp
BEFORE UPDATE ON public.business_directory
FOR EACH ROW
EXECUTE FUNCTION public.update_directory_timestamp();

-- Enable Row Level Security (RLS)
ALTER TABLE public.business_directory ENABLE ROW LEVEL SECURITY;

-- 1. Public Read Policy: Any user can read active and published listings
DROP POLICY IF EXISTS "Public can view published active directory listings" ON public.business_directory;
CREATE POLICY "Public can view published active directory listings"
ON public.business_directory
FOR SELECT
USING (
  status = 'published' AND is_active = TRUE
);

-- 2. Tenant Workspace Members Read Policy: Members can view their own company listings in any status
DROP POLICY IF EXISTS "Workspace members can view own company directory listings" ON public.business_directory;
CREATE POLICY "Workspace members can view own company directory listings"
ON public.business_directory
FOR SELECT
TO authenticated
USING (
  company_id IN (
    SELECT company_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- 3. Tenant Owners & Managers Insert Policy: Can submit listings for their workspace
DROP POLICY IF EXISTS "Workspace owners and managers can register directory listings" ON public.business_directory;
CREATE POLICY "Workspace owners and managers can register directory listings"
ON public.business_directory
FOR INSERT
TO authenticated
WITH CHECK (
  company_id IN (
    SELECT company_id FROM public.profiles
    WHERE id = auth.uid() AND role IN ('owner', 'manager', 'platform_admin')
  )
);

-- 4. Tenant Owners & Managers Update Policy: Can update their own workspace listings
DROP POLICY IF EXISTS "Workspace owners and managers can update own directory listings" ON public.business_directory;
CREATE POLICY "Workspace owners and managers can update own directory listings"
ON public.business_directory
FOR UPDATE
TO authenticated
USING (
  company_id IN (
    SELECT company_id FROM public.profiles
    WHERE id = auth.uid() AND role IN ('owner', 'manager', 'platform_admin')
  )
)
WITH CHECK (
  company_id IN (
    SELECT company_id FROM public.profiles
    WHERE id = auth.uid() AND role IN ('owner', 'manager', 'platform_admin')
  )
);

-- 5. Platform Admin Full Access Policy
DROP POLICY IF EXISTS "Platform admin full access to directory" ON public.business_directory;
CREATE POLICY "Platform admin full access to directory"
ON public.business_directory
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'platform_admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'platform_admin'
  )
);
