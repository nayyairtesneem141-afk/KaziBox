'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, Button, Badge, Modal, Input, Select, Avatar } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation } from '@/lib/i18n';
import {
  getTeamMembers,
  inviteTeamMember,
  updateMemberRole,
  deactivateTeamMember,
  reactivateTeamMember,
} from '@/lib/team';
import { TeamMember, UserRole } from '@kazibox/sdk';

export default function TeamPage() {
  const { user, workspace } = useSession();
  const { t } = useTranslation();

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Invite modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('worker');
  const [inviteError, setInviteError] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);

  // Role edit modal state
  const [editRoleModalOpen, setEditRoleModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [newRole, setNewRole] = useState<UserRole>('worker');

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  const loadMembers = useCallback(async () => {
    if (!workspace) return;
    setIsLoading(true);
    // Supabase replacement: await supabase.from('team_members').select('*').eq('company_id', workspace.company_id)
    const list = await getTeamMembers(workspace.company_id);
    setMembers(list);
    setIsLoading(false);
  }, [workspace]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // Role Gate: strictly owners and platform admins
  if (!isOwner) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">Accès restreint</h2>
        <p className="text-sm text-[#6B7280]">
          Seuls les propriétaires de l'entreprise peuvent accéder à la gestion de l'équipe.
        </p>
      </div>
    );
  }

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace) return;
    if (!inviteName || !inviteEmail) {
      setInviteError('Veuillez remplir tous les champs obligatoires.');
      return;
    }
    setInviteError('');
    setInviteLoading(true);

    const { error } = await inviteTeamMember(workspace.company_id, {
      name: inviteName,
      email: inviteEmail,
      role: inviteRole,
    });

    setInviteLoading(false);
    if (error) {
      setInviteError(error.message);
      return;
    }

    setInviteModalOpen(false);
    setInviteName('');
    setInviteEmail('');
    setInviteRole('worker');
    await loadMembers();
  };

  const handleUpdateRole = async () => {
    if (!workspace || !selectedMember) return;
    await updateMemberRole(workspace.company_id, selectedMember.id, newRole);
    setEditRoleModalOpen(false);
    setSelectedMember(null);
    await loadMembers();
  };

  const handleToggleStatus = async (m: TeamMember) => {
    if (!workspace) return;
    if (m.status === 'deactivated') {
      await reactivateTeamMember(workspace.company_id, m.id);
    } else {
      await deactivateTeamMember(workspace.company_id, m.id);
    }
    await loadMembers();
  };

  const roleOptions = [
    { value: 'worker', label: `${t('roles.worker')} (${t('team.role_info_worker')})` },
    { value: 'manager', label: `${t('roles.manager')} (${t('team.role_info_manager')})` },
    { value: 'owner', label: `${t('roles.owner')} (${t('team.role_info_owner')})` },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
            {t('team.title')}
          </h1>
          <p className="text-sm sm:text-base text-[#6B7280] mt-1">
            {t('team.subtitle')} &bull; {members.length} {t('team.members_count')}
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => setInviteModalOpen(true)}
          leftIcon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
          }
        >
          {t('team.invite_button')}
        </Button>
      </div>

      {/* Role explanation banner for non-tech-savvy users */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          <Badge variant="yellow" size="sm" className="mb-2">
            {t('roles.owner')}
          </Badge>
          <p className="text-xs text-[#6B7280]">{t('team.role_info_owner')}</p>
        </div>
        <div className="p-4 bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          <Badge variant="green" size="sm" className="mb-2">
            {t('roles.manager')}
          </Badge>
          <p className="text-xs text-[#6B7280]">{t('team.role_info_manager')}</p>
        </div>
        <div className="p-4 bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          <Badge variant="gray" size="sm" className="mb-2">
            {t('roles.worker')}
          </Badge>
          <p className="text-xs text-[#6B7280]">{t('team.role_info_worker')}</p>
        </div>
      </div>

      {/* Team Members List */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-xs font-bold text-[#6B7280] uppercase tracking-wider">
                <th className="py-3.5 px-6">{t('team.member_name')}</th>
                <th className="py-3.5 px-6">{t('team.member_role')}</th>
                <th className="py-3.5 px-6">{t('team.member_status')}</th>
                <th className="py-3.5 px-6">{t('team.member_joined')}</th>
                <th className="py-3.5 px-6 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E7EB] text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[#6B7280]">
                    {t('common.loading')}
                  </td>
                </tr>
              ) : (
                members.map((m) => (
                  <tr key={m.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.name} size="md" />
                        <div>
                          <p className="font-bold text-[#1F2937]">{m.name}</p>
                          <p className="text-xs text-[#6B7280]">{m.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <Badge
                        variant={
                          m.role === 'owner'
                            ? 'yellow'
                            : m.role === 'platform_admin'
                            ? 'purple'
                            : m.role === 'manager'
                            ? 'green'
                            : 'gray'
                        }
                        size="sm"
                      >
                        {t(`roles.${m.role}`)}
                      </Badge>
                    </td>
                    <td className="py-4 px-6">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                          m.status === 'active'
                            ? 'text-emerald-700'
                            : m.status === 'invited'
                            ? 'text-amber-700'
                            : 'text-red-700'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            m.status === 'active'
                              ? 'bg-emerald-500'
                              : m.status === 'invited'
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                          }`}
                        />
                        {t(`common.${m.status}`)}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-xs text-[#6B7280]">
                      {new Date(m.joined_at).toLocaleDateString()}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {/* Cannot modify self */}
                      {m.user_id !== user?.id && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setSelectedMember(m);
                              setNewRole(m.role);
                              setEditRoleModalOpen(true);
                            }}
                            className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] hover:bg-white text-xs font-bold text-[#1F2937] transition-all min-h-[36px]"
                          >
                            {t('team.change_role')}
                          </button>
                          <button
                            onClick={() => handleToggleStatus(m)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all min-h-[36px] ${
                              m.status === 'deactivated'
                                ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                : 'bg-red-50 text-red-700 hover:bg-red-100'
                            }`}
                          >
                            {m.status === 'deactivated'
                              ? t('team.reactivate')
                              : t('team.deactivate')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Invite Member Modal */}
      <Modal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        title={t('team.invite_title')}
        description={t('team.invite_desc')}
      >
        {inviteError && (
          <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">
            {inviteError}
          </div>
        )}

        <form onSubmit={handleInviteSubmit} className="space-y-4">
          <Input
            label={t('team.invite_name_label')}
            required
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder="Ex: Ousmane Koné"
          />

          <Input
            label={t('team.invite_email_label')}
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="ousmane@entreprise.com"
          />

          <Select
            label={t('team.invite_role_label')}
            options={roleOptions}
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as UserRole)}
          />

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-[#E5E7EB]">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setInviteModalOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={inviteLoading}
            >
              {t('team.send_invite')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Role Modal */}
      <Modal
        isOpen={editRoleModalOpen}
        onClose={() => setEditRoleModalOpen(false)}
        title={t('team.change_role')}
        description={`Membre : ${selectedMember?.name}`}
      >
        <div className="space-y-4 py-2">
          <Select
            label={t('team.invite_role_label')}
            options={roleOptions}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
          />

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-[#E5E7EB]">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setEditRoleModalOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="md" onClick={handleUpdateRole}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
