import { User, Workspace, TeamMember, NotificationItem } from '@kazibox/sdk';

// Default mock workspaces
export const INITIAL_WORKSPACES: Workspace[] = [
  {
    id: 'ws-palmeraie-01',
    company_id: 'ws-palmeraie-01',
    name: 'Hôtel & Résidence Palmeraie',
    country: 'Côte d’Ivoire',
    currency: 'XOF',
    language: 'fr',
    logo_url: '',
    created_at: '2026-01-15T08:00:00Z',
    plan: 'pro',
    status: 'active',
  },
  {
    id: 'ws-garage-02',
    company_id: 'ws-garage-02',
    name: 'Garage & Mécanique Express',
    country: 'Sénégal',
    currency: 'XOF',
    language: 'fr',
    logo_url: '',
    created_at: '2026-02-10T10:30:00Z',
    plan: 'starter',
    status: 'active',
  },
];

// 5 initial users covering all roles
export const INITIAL_USERS: (User & { password_hash: string })[] = [
  {
    id: 'usr-owner-01',
    email: 'owner@palmeraie.com',
    name: 'Mamadou Diallo',
    role: 'owner',
    company_id: 'ws-palmeraie-01',
    phone: '+225 07 12 34 56',
    created_at: '2026-01-15T08:00:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-manager-02',
    email: 'manager@palmeraie.com',
    name: 'Fatou Cissé',
    role: 'manager',
    company_id: 'ws-palmeraie-01',
    phone: '+225 05 98 76 54',
    created_at: '2026-01-16T09:00:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-worker-03',
    email: 'worker@palmeraie.com',
    name: 'Kouamé Koffi',
    role: 'worker',
    company_id: 'ws-palmeraie-01',
    phone: '+225 01 23 45 67',
    created_at: '2026-01-20T11:00:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-owner-sn-04',
    email: 'owner@autoexpress.sn',
    name: 'Ibrahima Ndiaye',
    role: 'owner',
    company_id: 'ws-garage-02',
    phone: '+221 77 654 32 10',
    created_at: '2026-02-10T10:30:00Z',
    password_hash: 'password123',
  },
  {
    id: 'usr-admin-05',
    email: 'admin@kazibox.com',
    name: 'Amadou Ba',
    role: 'platform_admin',
    company_id: 'ws-palmeraie-01',
    phone: '+225 07 00 00 01',
    created_at: '2026-01-01T00:00:00Z',
    password_hash: 'password123',
  },
];

export const INITIAL_MEMBERS: TeamMember[] = [
  {
    id: 'tm-1',
    company_id: 'ws-palmeraie-01',
    user_id: 'usr-owner-01',
    name: 'Mamadou Diallo',
    email: 'owner@palmeraie.com',
    role: 'owner',
    status: 'active',
    joined_at: '2026-01-15T08:00:00Z',
  },
  {
    id: 'tm-2',
    company_id: 'ws-palmeraie-01',
    user_id: 'usr-manager-02',
    name: 'Fatou Cissé',
    email: 'manager@palmeraie.com',
    role: 'manager',
    status: 'active',
    joined_at: '2026-01-16T09:00:00Z',
  },
  {
    id: 'tm-3',
    company_id: 'ws-palmeraie-01',
    user_id: 'usr-worker-03',
    name: 'Kouamé Koffi',
    email: 'worker@palmeraie.com',
    role: 'worker',
    status: 'active',
    joined_at: '2026-01-20T11:00:00Z',
  },
  {
    id: 'tm-4',
    company_id: 'ws-garage-02',
    user_id: 'usr-owner-sn-04',
    name: 'Ibrahima Ndiaye',
    email: 'owner@autoexpress.sn',
    role: 'owner',
    status: 'active',
    joined_at: '2026-02-10T10:30:00Z',
  },
];

export const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    company_id: 'ws-palmeraie-01',
    title: 'Bienvenue sur la plateforme',
    message: 'Votre espace de travail est initialisé. Vous pouvez inviter votre équipe et explorer le catalogue.',
    type: 'success',
    read: false,
    created_at: '2026-10-04T10:00:00Z',
  },
  {
    id: 'notif-2',
    company_id: 'ws-palmeraie-01',
    title: 'Alerte sécurité',
    message: 'Nouvelle connexion enregistrée depuis Abidjan.',
    type: 'info',
    read: true,
    created_at: '2026-10-03T14:30:00Z',
  },
  {
    id: 'notif-3',
    company_id: 'ws-garage-02',
    title: 'Bienvenue sur votre espace Garage',
    message: 'Configurez vos paramètres de facturation pour démarrer.',
    type: 'info',
    read: false,
    created_at: '2026-10-04T09:15:00Z',
  },
];

// Persistent state accessor for browser & SSR
const STORAGE_KEYS = {
  WORKSPACES: 'kazibox_db_workspaces',
  USERS: 'kazibox_db_users',
  MEMBERS: 'kazibox_db_members',
  NOTIFICATIONS: 'kazibox_db_notifications',
  CURRENT_SESSION: 'kazibox_current_session',
};

export const getStore = () => {
  if (typeof window === 'undefined') {
    return {
      workspaces: [...INITIAL_WORKSPACES],
      users: [...INITIAL_USERS],
      members: [...INITIAL_MEMBERS],
      notifications: [...INITIAL_NOTIFICATIONS],
    };
  }

  const getOrSet = <T>(key: string, initial: T): T => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) return JSON.parse(stored);
      localStorage.setItem(key, JSON.stringify(initial));
      return initial;
    } catch {
      return initial;
    }
  };

  return {
    workspaces: getOrSet(STORAGE_KEYS.WORKSPACES, INITIAL_WORKSPACES),
    users: getOrSet(STORAGE_KEYS.USERS, INITIAL_USERS),
    members: getOrSet(STORAGE_KEYS.MEMBERS, INITIAL_MEMBERS),
    notifications: getOrSet(STORAGE_KEYS.NOTIFICATIONS, INITIAL_NOTIFICATIONS),
  };
};

export const setStoreItem = <T>(key: keyof typeof STORAGE_KEYS, val: T) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(val));
  } catch (err) {
    console.error('Storage error:', err);
  }
};
