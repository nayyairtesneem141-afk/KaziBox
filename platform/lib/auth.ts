import { AuthSession, User } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { getWorkspace } from './workspace';

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
 * In Supabase: const { data: { session } } = await supabase.auth.getSession();
 */
export async function getSession(): Promise<AuthSession | null> {
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
 * In Supabase: const { data: { user } } = await supabase.auth.getUser();
 */
export async function getUser(): Promise<User | null> {
  const session = await getSession();
  return session?.user || null;
}

/**
 * Sign in with email and password
 * In Supabase: const { data, error } = await supabase.auth.signInWithPassword({ email, password });
 */
export async function signInWithPassword(params: {
  email: string;
  password?: string;
}): Promise<{ data: { session: AuthSession | null; user: User | null }; error: Error | null }> {
  // Simulate network latency
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

  // Retrieve user's active workspace
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
 * Sign up new user and auto-create first workspace
 * In Supabase:
 * const { data, error } = await supabase.auth.signUp({ email, password });
 * const { data: company } = await supabase.from('companies').insert({...});
 */
export async function signUp(params: {
  email: string;
  password?: string;
  name: string;
  phone?: string;
  companyName: string;
  country: string;
  currency: string;
}): Promise<{ data: { session: AuthSession | null; user: User | null }; error: Error | null }> {
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
    data: { session, user: newUser },
    error: null,
  };
}

/**
 * Sign out user
 * In Supabase: await supabase.auth.signOut();
 */
export async function signOut(): Promise<{ error: Error | null }> {
  persistSession(null);
  return { error: null };
}

/**
 * Send password reset email
 * In Supabase: await supabase.auth.resetPasswordForEmail(email);
 */
export async function resetPasswordForEmail(
  email: string
): Promise<{ error: Error | null }> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { error: null };
}

/**
 * Update authenticated user profile
 * In Supabase: await supabase.auth.updateUser({ data: updates });
 */
export async function updateUserProfile(
  updates: Partial<User>
): Promise<{ data: { user: User | null }; error: Error | null }> {
  const session = await getSession();
  if (!session) return { data: { user: null }, error: new Error('Non authentifié') };

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

  // Update session
  session.user = updatedUser;
  persistSession(session);

  return { data: { user: updatedUser }, error: null };
}
