import { TeamMember, UserRole } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';

/**
 * Fetch team members for a company
 * In Supabase: const { data } = await supabase.from('team_members').select('*').eq('company_id', companyId);
 */
export async function getTeamMembers(companyId: string): Promise<TeamMember[]> {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const store = getStore();
  return store.members.filter((m) => m.company_id === companyId);
}

/**
 * Invite a new member to the workspace
 * In Supabase: const { data } = await supabase.from('team_members').insert({...}).select().single();
 */
export async function inviteTeamMember(
  companyId: string,
  params: {
    name: string;
    email: string;
    role: UserRole;
  }
): Promise<{ data: TeamMember | null; error: Error | null }> {
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
 * In Supabase: const { data } = await supabase.from('team_members').update({ role }).eq('id', memberId).eq('company_id', companyId);
 */
export async function updateMemberRole(
  companyId: string,
  memberId: string,
  newRole: UserRole
): Promise<{ data: TeamMember | null; error: Error | null }> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const store = getStore();
  const idx = store.members.findIndex(
    (m) => m.id === memberId && m.company_id === companyId
  );

  if (idx === -1) {
    return { data: null, error: new Error('Membre introuvable') };
  }

  store.members[idx].role = newRole;
  setStoreItem('MEMBERS', store.members);

  return { data: store.members[idx], error: null };
}

/**
 * Deactivate a team member's access
 * In Supabase: const { data } = await supabase.from('team_members').update({ status: 'deactivated' }).eq('id', memberId).eq('company_id', companyId);
 */
export async function deactivateTeamMember(
  companyId: string,
  memberId: string
): Promise<{ data: TeamMember | null; error: Error | null }> {
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
