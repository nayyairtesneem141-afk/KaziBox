import { NextRequest } from 'next/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';
import { getStore } from './storage';

export interface ServerUserSession {
  userId: string;
  companyId: string;
  role: 'owner' | 'manager' | 'worker' | 'platform_admin';
  name?: string;
  email?: string;
}

/**
 * Extract authenticated session from incoming NextRequest
 */
export async function getServerSession(req: NextRequest): Promise<ServerUserSession | null> {
  let userId: string | null = null;
  let companyId: string | null = null;

  // 1. Try kazibox_session cookie
  const sessionCookie = req.cookies.get('kazibox_session')?.value;
  if (sessionCookie) {
    try {
      const decoded = JSON.parse(decodeURIComponent(sessionCookie));
      if (decoded.companyId) {
        userId = decoded.userId || null;
        companyId = decoded.companyId;
      }
    } catch {
      // Continue to next check
    }
  }

  // 2. Try headers (x-company-id, x-user-id)
  if (!companyId) {
    companyId = req.headers.get('x-company-id');
  }
  if (!userId) {
    userId = req.headers.get('x-user-id');
  }

  // 3. Fallback to default company if none supplied
  if (!companyId) {
    companyId = '11111111-1111-4111-8111-111111111111';
  }

  // Fetch role from Supabase or storage
  let role: ServerUserSession['role'] = 'owner';
  let email = 'admin@kazibox.com';
  let name = 'Admin KaziBox';

  if (isSupabaseConfigured() && userId) {
    const supabase: any = createAdminClient();
    if (supabase) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        role = (profile.role as any) || 'owner';
        email = profile.email || email;
        name = profile.name || name;
        companyId = profile.company_id || companyId;
      }
    }
  }

  if (!userId) {
    const store = getStore();
    const defaultUser = store.users.find((u) => u.company_id === companyId) || store.users[0];
    if (defaultUser) {
      userId = defaultUser.id;
      role = defaultUser.role as any;
      email = defaultUser.email;
      name = defaultUser.name;
    } else {
      userId = 'usr-admin-1';
    }
  }

  return {
    userId,
    companyId: companyId || '11111111-1111-4111-8111-111111111111',
    role,
    name,
    email,
  };
}
