-- KaziBox Supabase Migration (13_auth_tickets.sql)
-- Persistent storage for one-time OAuth PKCE authorization tickets with atomic single-use burn
-- Enforces Row Level Security (RLS) and restricts operations exclusively to service_role credentials

-- 1. Create table public.auth_tickets
CREATE TABLE IF NOT EXISTS public.auth_tickets (
  code_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  code_challenge_method TEXT NOT NULL DEFAULT 'S256' CHECK (code_challenge_method IN ('S256')),
  consumed BOOLEAN NOT NULL DEFAULT FALSE,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- 2. Indexes for fast atomic exchange lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_auth_tickets_lookup 
  ON public.auth_tickets (code_hash, consumed, expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_tickets_company_id 
  ON public.auth_tickets (company_id);

CREATE INDEX IF NOT EXISTS idx_auth_tickets_user_id 
  ON public.auth_tickets (user_id);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE public.auth_tickets ENABLE ROW LEVEL SECURITY;

-- 4. Revoke all permissions from public, anon, and authenticated roles
-- Tickets contain sensitive authorization proofs and must NEVER be accessible directly from browser clients
REVOKE ALL ON TABLE public.auth_tickets FROM PUBLIC;
REVOKE ALL ON TABLE public.auth_tickets FROM anon;
REVOKE ALL ON TABLE public.auth_tickets FROM authenticated;

-- 5. Grant full access exclusively to trusted service_role (used by server-side Next.js route handlers)
GRANT ALL ON TABLE public.auth_tickets TO service_role;

-- 6. Atomic ticket consumption RPC function
-- Guarantees atomic check-and-burn across distributed serverless instances with zero race conditions
CREATE OR REPLACE FUNCTION public.consume_auth_ticket(
  p_code_hash TEXT
)
RETURNS TABLE (
  user_id UUID,
  company_id UUID,
  module_id TEXT,
  redirect_uri TEXT,
  code_challenge TEXT,
  code_challenge_method TEXT,
  consumed BOOLEAN,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.auth_tickets
  SET 
    consumed = TRUE,
    consumed_at = NOW()
  WHERE public.auth_tickets.code_hash = p_code_hash
    AND public.auth_tickets.consumed = FALSE
    AND public.auth_tickets.expires_at > NOW()
  RETURNING 
    public.auth_tickets.user_id,
    public.auth_tickets.company_id,
    public.auth_tickets.module_id,
    public.auth_tickets.redirect_uri,
    public.auth_tickets.code_challenge,
    public.auth_tickets.code_challenge_method,
    public.auth_tickets.consumed,
    public.auth_tickets.expires_at;
END;
$$;

-- Revoke execute from public/anon/authenticated, grant exclusively to service_role
REVOKE ALL ON FUNCTION public.consume_auth_ticket(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_auth_ticket(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.consume_auth_ticket(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_ticket(TEXT) TO service_role;

