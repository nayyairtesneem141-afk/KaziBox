import { NotificationItem, NotificationType } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { isSupabaseConfigured } from './supabase/config';

/**
 * Fetch notifications for current workspace
 */
export async function getNotifications(companyId: string): Promise<NotificationItem[]> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        return data.map((n: any) => ({
          id: n.id,
          company_id: n.company_id,
          title: n.title,
          message: n.message,
          type: n.type as NotificationType,
          read: n.read,
          created_at: n.created_at,
          link: n.link || undefined,
        }));
      }
    }
  }

  const store = getStore();
  return store.notifications
    .filter((n) => n.company_id === companyId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Mark single notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);
      if (!error) return true;
    }
  }

  const store = getStore();
  const idx = store.notifications.findIndex((n) => n.id === notificationId);
  if (idx !== -1) {
    store.notifications[idx].read = true;
    setStoreItem('NOTIFICATIONS', store.notifications);
    return true;
  }
  return false;
}

/**
 * Mark all notifications as read for current workspace
 */
export async function markAllNotificationsAsRead(companyId: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('company_id', companyId);
      if (!error) return true;
    }
  }

  const store = getStore();
  store.notifications = store.notifications.map((n) =>
    n.company_id === companyId ? { ...n, read: true } : n
  );
  setStoreItem('NOTIFICATIONS', store.notifications);
  return true;
}

/**
 * Generic dispatch helper for in-app notifications
 */
export async function createNotification(params: {
  companyId: string;
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
}): Promise<NotificationItem> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('notifications')
        .insert({
          company_id: params.companyId,
          title: params.title,
          message: params.message,
          type: params.type,
          read: false,
          link: params.link || null,
        })
        .select()
        .single();

      if (data && !error) {
        return {
          id: data.id,
          company_id: data.company_id,
          title: data.title,
          message: data.message,
          type: data.type as NotificationType,
          read: data.read,
          created_at: data.created_at,
          link: data.link || undefined,
        };
      }
    }
  }

  const store = getStore();
  const newNotif: NotificationItem = {
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    company_id: params.companyId,
    title: params.title,
    message: params.message,
    type: params.type,
    read: false,
    created_at: new Date().toISOString(),
    link: params.link,
  };

  store.notifications.unshift(newNotif);
  setStoreItem('NOTIFICATIONS', store.notifications);
  return newNotif;
}

/**
 * In-app Notification: Module Activated
 */
export async function notifyModuleActivated(companyId: string, moduleName: string) {
  return createNotification({
    companyId,
    title: `Module activé : ${moduleName}`,
    message: `Le module ${moduleName} a été activé avec succès sur votre espace de travail.`,
    type: 'success',
    link: '/modules/my-modules',
  });
}

/**
 * In-app Notification: Module Deactivated
 * Includes data retention notice: "Your data is kept for 30 days"
 */
export async function notifyModuleDeactivated(companyId: string, moduleName: string) {
  return createNotification({
    companyId,
    title: `Module désactivé : ${moduleName}`,
    message: `Le module ${moduleName} a été désactivé. Vos données sont conservées pendant 30 jours.`,
    type: 'warning',
    link: '/modules/catalogue',
  });
}

/**
 * In-app Notification: Subscription Activated
 */
export async function notifySubscriptionActivated(companyId: string, planName: string) {
  return createNotification({
    companyId,
    title: `Abonnement activé : ${planName}`,
    message: `Votre abonnement ${planName} est désormais actif pour l’ensemble de vos modules sélectionnés.`,
    type: 'success',
    link: '/billing',
  });
}

/**
 * In-app Notification: Subscription Expiring in 7 Days
 */
export async function notifySubscriptionExpiring(companyId: string, daysRemaining = 7) {
  return createNotification({
    companyId,
    title: `Abonnement expirant bientôt`,
    message: `Votre abonnement arrive à échéance dans ${daysRemaining} jours. Pensez à le renouveler pour maintenir vos modules actifs.`,
    type: 'warning',
    link: '/billing',
  });
}

/**
 * In-app Notification: Payment Failed
 */
export async function notifyPaymentFailed(companyId: string, amount = '15 000 XOF') {
  return createNotification({
    companyId,
    title: `Échec du prélèvement d'abonnement`,
    message: `La tentative de paiement de ${amount} a échoué. Veuillez vérifier votre moyen de paiement Mobile Money ou carte bancaire.`,
    type: 'alert',
    link: '/billing',
  });
}

