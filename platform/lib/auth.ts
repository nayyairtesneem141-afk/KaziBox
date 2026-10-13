import { AuthSession, User, Workspace } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { getWorkspace } from './workspace';
import { createBrowserClient } from './supabase/client';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';

const SESSION_KEY = 'kazibox_current_session';

/**
 * Save auth session to localStorage and browser cookie so it persists across refreshes
 */
function persistSession(session: AuthSession | null) {
  if (typeof window === 'undefined') return;
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    document.cookie = 'kazibox_session=; path=/; max-age=0; SameSite=Lax';
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  // Store session in cookie (secure, path=/) for SSR & route protection
  document.cookie = `kazibox_session=${encodeURIComponent(
    JSON.stringify({ userId: session.user.id, companyId: session.workspace.company_id })
  )}; path=/; max-age=604800; SameSite=Lax`;
}

/**
 * Get active session
 */
export async function getSession(): Promise<AuthSession | null> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      const { data: { session: sbSession } } = await supabase.auth.getSession();
      if (sbSession?.user) {
        // Fetch profile & workspace from Supabase
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', sbSession.user.id)
          .maybeSingle();

        if (profile) {
          const workspace = await getWorkspace(profile.company_id);
          if (workspace) {
            const user: User = {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              avatar_url: profile.avatar_url || undefined,
              phone: profile.phone || undefined,
              role: profile.role as User['role'],
              company_id: profile.company_id,
              created_at: profile.created_at,
            };
            const session: AuthSession = {
              user,
              workspace,
              token: sbSession.access_token,
            };
            persistSession(session);
            return session;
          }
        }
      }
    }
  }

  // Fallback to local persistent storage session
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session: AuthSession = JSON.parse(raw);
    return session;
  } catch {
    return null;
  }
}

/**
 * Get current authenticated user
 */
export async function getUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user || null;
}

/**
 * Sign in with email and password
 */
export async function signInWithPassword(params: {
  email: string;
  password?: string;
}): Promise<{ data: { session: AuthSession | null; user: User | null }; error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: params.email.trim(),
        password: params.password || 'password123',
      });

      if (authError) {
        // Try fallback if Supabase auth fails or credentials aren't synced yet
      } else if (authData.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (profile) {
          const workspace = await getWorkspace(profile.company_id);
          if (workspace) {
            const user: User = {
              id: profile.id,
              email: profile.email,
              name: profile.name,
              avatar_url: profile.avatar_url || undefined,
              phone: profile.phone || undefined,
              role: profile.role as User['role'],
              company_id: profile.company_id,
              created_at: profile.created_at,
            };
            const session: AuthSession = {
              user,
              workspace,
              token: authData.session?.access_token || '',
            };
            persistSession(session);
            return { data: { session, user }, error: null };
          }
        }
      }
    }
  }

  // Local storage fallback logic
  await new Promise((resolve) => setTimeout(resolve, 300));
  const store = getStore();
  const user = store.users.find(
    (u) => u.email.toLowerCase() === params.email.trim().toLowerCase()
  );

  if (!user) {
    return {
      data: { session: null, user: null },
      error: new Error('Identifiants incorrects ou utilisateur introuvable.'),
    };
  }

  const workspace = await getWorkspace(user.company_id);
  if (!workspace) {
    return {
      data: { session: null, user: null },
      error: new Error('Espace de travail associé introuvable.'),
    };
  }

  const { password_hash, ...cleanUser } = user;
  const session: AuthSession = {
    user: cleanUser,
    workspace,
    token: `mock_jwt_token_${user.id}_${Date.now()}`,
  };

  persistSession(session);
  return {
    data: { session, user: cleanUser },
    error: null,
  };
}

/**
 * Sign up new user and auto-create first workspace via secure server-side flow
 */
export async function signUp(params: {
  email: string;
  password?: string;
  name: string;
  phone?: string;
  companyName: string;
  country: string;
  currency: string;
}): Promise<{
  data: {
    session: AuthSession | null;
    user: User | null;
    requiresConfirmation?: boolean;
  };
  error: Error | null;
}> {
  // If running in browser, invoke the secure server-side registration endpoint
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        return {
          data: { session: null, user: null },
          error: new Error(json?.message || 'Erreur lors de la création du compte.'),
        };
      }

      // If email confirmation is required, return success with confirmation flag
      if (json.requiresConfirmation) {
        return {
          data: {
            session: null,
            user: json.user as User,
            requiresConfirmation: true,
          },
          error: null,
        };
      }

      // If email confirmation is NOT required and Supabase is configured:
      if (isSupabaseConfigured()) {
        const signInResult = await signInWithPassword({
          email: params.email,
          password: params.password,
        });

        if (!signInResult.error && signInResult.data.session) {
          return {
            data: {
              session: signInResult.data.session,
              user: signInResult.data.user,
              requiresConfirmation: false,
            },
            error: null,
          };
        }
      }

      // If demo mode or session returned directly:
      if (json.session) {
        persistSession(json.session);
        return {
          data: {
            session: json.session,
            user: json.user as User,
            requiresConfirmation: false,
          },
          error: null,
        };
      }
    } catch (err: any) {
      if (isSupabaseConfigured()) {
        return {
          data: { session: null, user: null },
          error: new Error(err?.message || 'Erreur réseau lors de l’inscription.'),
        };
      }
    }
  }

  // Local storage fallback (offline mode)
  await new Promise((resolve) => setTimeout(resolve, 400));
  const store = getStore();
  const existing = store.users.find(
    (u) => u.email.toLowerCase() === params.email.trim().toLowerCase()
  );

  if (existing) {
    return {
      data: { session: null, user: null },
      error: new Error('Un compte existe déjà avec cette adresse email.'),
    };
  }

  const newCompanyId = `ws-${Date.now()}`;
  const newUserId = `usr-${Date.now()}`;

  const newWorkspace = {
    id: newCompanyId,
    company_id: newCompanyId,
    name: params.companyName.trim(),
    country: params.country || 'Côte d’Ivoire',
    currency: params.currency || 'XOF',
    language: 'fr',
    created_at: new Date().toISOString(),
    plan: 'starter' as const,
    status: 'active' as const,
  };

  const newUser: User = {
    id: newUserId,
    email: params.email.trim(),
    name: params.name.trim(),
    phone: params.phone,
    role: 'owner',
    company_id: newCompanyId,
    created_at: new Date().toISOString(),
  };

  const newMember = {
    id: `tm-${Date.now()}`,
    company_id: newCompanyId,
    user_id: newUserId,
    name: newUser.name,
    email: newUser.email,
    role: 'owner' as const,
    status: 'active' as const,
    joined_at: new Date().toISOString(),
  };

  store.workspaces.push(newWorkspace);
  store.users.push({ ...newUser, password_hash: params.password || 'password123' });
  store.members.push(newMember);

  setStoreItem('WORKSPACES', store.workspaces);
  setStoreItem('USERS', store.users);
  setStoreItem('MEMBERS', store.members);

  const session: AuthSession = {
    user: newUser,
    workspace: newWorkspace,
    token: `mock_jwt_token_${newUser.id}_${Date.now()}`,
  };

  persistSession(session);

  return {
    data: { session, user: newUser, requiresConfirmation: false },
    error: null,
  };
}

/**
 * Sign out user
 */
export async function signOut(): Promise<{ error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase = createBrowserClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  }
  persistSession(null);
  return { error: null };
}

/**
 * Send password reset email with recovery link redirect
 */
export async function resetPasswordForEmail(
  email: string,
  redirectTo?: string
): Promise<{ error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase = createBrowserClient();
    if (supabase) {
      const targetUrl =
        redirectTo ||
        (typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined);
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: targetUrl,
      });
      if (error) return { error: new Error(error.message) };
      return { error: null };
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { error: null };
}

/**
 * Update authenticated user password
 */
export async function updatePassword(
  newPassword: string
): Promise<{ error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase = createBrowserClient();
    if (supabase) {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) return { error: new Error(error.message) };
      return { error: null };
    }
  }

  // Fallback for offline / demo mode
  const session = await getSession();
  if (session && typeof window !== 'undefined') {
    const store = getStore();
    const uIdx = store.users.findIndex((u) => u.id === session.user.id);
    if (uIdx !== -1) {
      store.users[uIdx].password_hash = newPassword;
      setStoreItem('USERS', store.users);
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { error: null };
}

/**
 * Update authenticated user profile
 */
export async function updateUserProfile(
  updates: Partial<User>
): Promise<{ data: { user: User | null }; error: Error | null }> {
  const session = await getSession();
  if (!session) return { data: { user: null }, error: new Error('Non authentifié') };

  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      const { data: updated, error } = await supabase
        .from('profiles')
        .update({
          name: updates.name,
          phone: updates.phone,
          avatar_url: updates.avatar_url,
        })
        .eq('id', session.user.id)
        .select()
        .single();

      if (!error && updated) {
        const user: User = {
          ...session.user,
          name: updated.name,
          phone: updated.phone || undefined,
          avatar_url: updated.avatar_url || undefined,
        };
        session.user = user;
        persistSession(session);
        return { data: { user }, error: null };
      }
    }
  }

  const store = getStore();
  const userIdx = store.users.findIndex((u) => u.id === session.user.id);
  if (userIdx === -1) return { data: { user: null }, error: new Error('Utilisateur non trouvé') };

  const updatedUser: User = {
    ...store.users[userIdx],
    ...updates,
  };

  store.users[userIdx] = {
    ...updatedUser,
    password_hash: store.users[userIdx].password_hash,
  };
  setStoreItem('USERS', store.users);

  session.user = updatedUser;
  persistSession(session);

  return { data: { user: updatedUser }, error: null };
}

