import { createSsoHandler, ModuleTokenPayload, IdempotencyStore } from '@kazibox/sdk';
import { getPharmaSsoIdempotencyStore } from './storage.js';

export interface PharmaSession {
  userId: string;
  userName: string;
  userEmail: string;
  companyId: string;
  companyName: string;
  role: string;
  language: 'fr' | 'en';
  currency: string;
  expiresAt: string;
}

export function createPharmaSsoHandoff(ssoSecret?: string, store?: IdempotencyStore) {
  const effectiveStore = store || getPharmaSsoIdempotencyStore();
  const handler = createSsoHandler({ ssoSecret, store: effectiveStore });

  return async function authenticateHandoff(token: string | null | undefined): Promise<{
    authenticated: boolean;
    session?: PharmaSession;
    error?: string;
  }> {
    const res = await handler(token);
    if (!res.authenticated || !res.session) {
      return { authenticated: false, error: res.error || 'Authentication failed' };
    }

    const payload: ModuleTokenPayload = res.session;
    const session: PharmaSession = {
      userId: payload.userId,
      userName: payload.userName,
      userEmail: payload.userEmail,
      companyId: payload.workspaceId,
      companyName: payload.workspaceName,
      role: payload.role,
      language: payload.language,
      currency: payload.currency,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };

    return {
      authenticated: true,
      session,
    };
  };
}
