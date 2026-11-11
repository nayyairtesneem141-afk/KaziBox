export type UserRole = 'platform_admin' | 'owner' | 'manager' | 'worker';

export type MemberStatus = 'active' | 'invited' | 'deactivated';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  phone?: string;
  role: UserRole;
  company_id: string;
  created_at: string;
}

export interface Workspace {
  id: string;
  company_id: string;
  name: string;
  country: string;
  currency: string;
  language: string;
  logo_url?: string;
  created_at: string;
  plan: 'free' | 'starter' | 'pro' | 'enterprise';
  status: 'active' | 'trial' | 'suspended';
}

export interface TeamMember {
  id: string;
  company_id: string;
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  status: MemberStatus;
  joined_at: string;
}

export type NotificationType = 'info' | 'warning' | 'success' | 'alert';

export interface NotificationItem {
  id: string;
  company_id: string;
  user_id?: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  created_at: string;
  link?: string;
}

export interface AuthSession {
  user: User;
  workspace: Workspace;
  token: string;
}

export type ModuleScope =
  | 'read:context'
  | 'write:finance'
  | 'write:events'
  | 'read:subscription'
  | 'auth:exchange'
  | 'write:billing'
  | string;

export interface HeadlessAuthExchangeRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface HeadlessAuthResponse {
  success: boolean;
  tokenType: 'Bearer';
  accessToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    companyId: string;
  };
  workspace: {
    id: string;
    name: string;
    currency: string;
    country: string;
  };
}

export interface HeadlessCheckoutRequest {
  planId: string;
  billingCycle: 'monthly' | 'yearly' | 'flex';
  companyId?: string;
  moduleIds?: string[];
  country?: 'CD' | 'CM' | 'SN' | 'CI';
  amount?: number;
  referralCode?: string;
  customer?: { id?: string; name?: string; email?: string; phone?: string };
  returnUrl: string;
}

export interface HeadlessCheckoutResponse {
  success: boolean;
  paymentId: string;
  reference: string;
  status: 'pending' | 'succeeded' | 'failed';
  paymentUrl?: string;
  ussdPrompt?: string | null;
  amount: number;
  currency: string;
}
