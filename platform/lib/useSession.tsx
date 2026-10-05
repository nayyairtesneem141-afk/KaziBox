'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AuthSession, User, Workspace } from '@kazibox/sdk';
import { getSession, signOut as authSignOut } from './auth';
import { getWorkspaces, switchWorkspace as libSwitchWorkspace } from './workspace';

interface SessionContextType {
  session: AuthSession | null;
  user: User | null;
  workspace: Workspace | null;
  allWorkspaces: Workspace[];
  isLoading: boolean;
  refreshSession: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType>({
  session: null,
  user: null,
  workspace: null,
  allWorkspaces: [],
  isLoading: true,
  refreshSession: async () => {},
  switchCompany: async () => {},
  signOut: async () => {},
});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const currentSession = await getSession();
    if (!currentSession) {
      setSession(null);
      setIsLoading(false);
      return;
    }
    setSession(currentSession);
    const workspaces = await getWorkspaces();
    setAllWorkspaces(workspaces);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const switchCompany = async (companyId: string) => {
    setIsLoading(true);
    await libSwitchWorkspace(companyId);
    await refreshSession();
    router.refresh();
  };

  const handleSignOut = async () => {
    await authSignOut();
    setSession(null);
    router.push('/login');
  };

  return (
    <SessionContext.Provider
      value={{
        session,
        user: session?.user || null,
        workspace: session?.workspace || null,
        allWorkspaces,
        isLoading,
        refreshSession,
        switchCompany,
        signOut: handleSignOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => useContext(SessionContext);
