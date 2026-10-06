import { TeamMember, UserRole } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { dispatchWebhookEvent } from './webhooks';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { isSupabaseConfigured } from './supabase/config';

/**
 * Fetch team members for a company
 */
export async function getTeamMembers(companyId: string): Promise<TeamMember[]> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data } = await supabase
        .from('team_members')
        .select('*')
        .eq('company_id', companyId);

      if (data && data.length > 0) {
        return data.map((m: any) => ({
          id: m.id,
          company_id: m.company_id,
          user_id: m.user_id || undefined,
          name: m.name,
          email: m.email,
          role: m.role as UserRole,
          status: m.status as TeamMember['status'],
          joined_at: m.joined_at,
        }));
      }
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 200));
  const store = getStore();
  return store.members.filter((m) => m.company_id === companyId);
}

/**
 * Invite a new member to the workspace
 */
export async function inviteTeamMember(
  companyId: string,
  params: {
    name: string;
    email: string;
    role: UserRole;
  }
): Promise<{ data: TeamMember | null; error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('team_members')
        .insert({
          company_id: companyId,
          name: params.name.trim(),
          email: params.email.trim().toLowerCase(),
          role: params.role,
          status: 'invited',
        })
        .select()
        .single();

      if (error || !data) {
        return { data: null, error: new Error(error?.message || 'Erreur lors de l’invitation') };
      }

      const newMember: TeamMember = {
        id: data.id,
        company_id: data.company_id,
        user_id: data.user_id || undefined,
        name: data.name,
        email: data.email,
        role: data.role as UserRole,
        status: data.status as TeamMember['status'],
        joined_at: data.joined_at,
      };

      return { data: newMember, error: null };
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 350));
  const store = getStore();

  const existing = store.members.find(
    (m) => m.company_id === companyId && m.email.toLowerCase() === params.email.trim().toLowerCase()
  );
  if (existing) {
    return { data: null, error: new Error('Cet email est déjà membre de cet espace') };
  }

  const newMember: TeamMember = {
    id: `tm-${Date.now()}`,
    company_id: companyId,
    user_id: `usr-invited-${Date.now()}`,
    name: params.name.trim(),
    email: params.email.trim().toLowerCase(),
    role: params.role,
    status: 'invited',
    joined_at: new Date().toISOString(),
  };

  store.members.push(newMember);
  setStoreItem('MEMBERS', store.members);

  return { data: newMember, error: null };
}

/**
 * Update a member's role
 */
export async function updateMemberRole(
  companyId: string,
  memberId: string,
  newRole: UserRole
): Promise<{ data: TeamMember | null; error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      const { data: existing } = await supabase
        .from('team_members')
        .select('*')
        .eq('id', memberId)
        .eq('company_id', companyId)
        .maybeSingle();

      const oldRole = existing?.role || 'worker';

      const { data, error } = await supabase
        .from('team_members')
        .update({ role: newRole })
        .eq('id', memberId)
        .eq('company_id', companyId)
        .select()
        .single();

      if (error || !data) {
        return { data: null, error: new Error(error?.message || 'Membre introuvable') };
      }

      await dispatchWebhookEvent('user.role_changed', {
        workspaceId: companyId,
        memberId,
        userId: data.user_id,
        previousRole: oldRole,
        newRole,
        updatedAt: new Date().toISOString(),
      });

      const updated: TeamMember = {
        id: data.id,
        company_id: data.company_id,
        user_id: data.user_id || undefined,
        name: data.name,
        email: data.email,
        role: data.role as UserRole,
        status: data.status as TeamMember['status'],
        joined_at: data.joined_at,
      };

      return { data: updated, error: null };
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
  const store = getStore();
  const idx = store.members.findIndex(
    (m) => m.id === memberId && m.company_id === companyId
  );

  if (idx === -1) {
    return { data: null, error: new Error('Membre introuvable') };
  }

  const oldRole = store.members[idx].role;
  store.members[idx].role = newRole;
  setStoreItem('MEMBERS', store.members);

  // Dispatch webhook event to active modules
  await dispatchWebhookEvent('user.role_changed', {
    workspaceId: companyId,
    memberId,
    userId: store.members[idx].user_id,
    previousRole: oldRole,
    newRole,
    updatedAt: new Date().toISOString(),
  });

  return { data: store.members[idx], error: null };
}

/**
 * Deactivate a team member's access
 */
export async function deactivateTeamMember(
  companyId: string,
  memberId: string
): Promise<{ data: TeamMember | null; error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase = createBrowserClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('team_members')
        .update({ status: 'deactivated' })
        .eq('id', memberId)
        .eq('company_id', companyId)
        .select()
        .single();

      if (error || !data) {
        return { data: null, error: new Error(error?.message || 'Membre introuvable') };
      }

      return {
        data: {
          id: data.id,
          company_id: data.company_id,
          user_id: data.user_id || undefined,
          name: data.name,
          email: data.email,
          role: data.role as UserRole,
          status: data.status as TeamMember['status'],
          joined_at: data.joined_at,
        },
        error: null,
      };
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
  const store = getStore();
  const idx = store.members.findIndex(
    (m) => m.id === memberId && m.company_id === companyId
  );

  if (idx === -1) {
    return { data: null, error: new Error('Membre introuvable') };
  }

  store.members[idx].status = 'deactivated';
  setStoreItem('MEMBERS', store.members);

  return { data: store.members[idx], error: null };
}

/**
 * Reactivate a deactivated team member
 */
export async function reactivateTeamMember(
  companyId: string,
  memberId: string
): Promise<{ data: TeamMember | null; error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase = createBrowserClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('team_members')
        .update({ status: 'active' })
        .eq('id', memberId)
        .eq('company_id', companyId)
        .select()
        .single();

      if (error || !data) {
        return { data: null, error: new Error(error?.message || 'Membre introuvable') };
      }

      return {
        data: {
          id: data.id,
          company_id: data.company_id,
          user_id: data.user_id || undefined,
          name: data.name,
          email: data.email,
          role: data.role as UserRole,
          status: data.status as TeamMember['status'],
          joined_at: data.joined_at,
        },
        error: null,
      };
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 250));
  const store = getStore();
  const idx = store.members.findIndex(
    (m) => m.id === memberId && m.company_id === companyId
  );

  if (idx === -1) {
    return { data: null, error: new Error('Membre introuvable') };
  }

  store.members[idx].status = 'active';
  setStoreItem('MEMBERS', store.members);

  return { data: store.members[idx], error: null };
}

